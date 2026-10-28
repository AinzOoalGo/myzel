import { describe, expect, it } from 'bun:test';
import { CONFIG } from '../src/core/config';
import { generateMap } from '../src/core/map';
import {
  connectedCount,
  findSource,
  growthQuote,
  mods,
  newGame,
  rivalStep,
  season,
  simulate,
  startGrowth,
  type GameState,
} from '../src/core/game';
import { deserialize, serialize } from '../src/core/save';
import v1Save from './fixtures/save-v1.json';

/** Fingerabdruck der Zone-1-Karte aus Version 0.4 (vor Zone 2), Seed 12345 */
const OLD_ZONE1_HASH = 1012954751;

const fingerprint = (seed: number) => {
  const m = generateMap(seed).filter((n) => n.zone === 1);
  let h = 0;
  for (const c of m.map((n) => `${n.type}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).join('|')) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return { h, count: m.length };
};

/** Verbindet die nächsten freien Knoten (Testhilfe). */
const connectN = (s: GameState, count: number, zone: 1 | 2 = 1) => {
  const ids = s.nodes
    .filter((n) => !n.connected && n.type !== 'stein' && n.type !== 'rivale' && n.zone === zone && n.owner === 0)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((n) => n.id);
  for (const id of ids) {
    s.nodes[id]!.connected = true;
    s.edges.push({ from: 0, to: id });
  }
};

/** Bringt ein Spiel per regulärem Wachstum über die Zone-2-Schwelle. */
const enterZone2 = (s: GameState) => {
  connectN(s, CONFIG.zone2.unlockAt - 1);
  const last = s.nodes.filter((n) => findSource(s, n.id)).sort((a, b) => a.dist - b.dist)[0]!;
  s.res.n = 1e30;
  expect(startGrowth(s, last.id)).toEqual({ ok: true });
  simulate(s, 600, 0.5);
};

describe('Karte mit Zone 2', () => {
  it('Zone-1-Knoten sind exakt wie vor dem Update (alte Spielstände bleiben gültig)', () => {
    const f = fingerprint(12345);
    expect(f.count).toBe(CONFIG.map.nodeCount);
    expect(f.h).toBe(OLD_ZONE1_HASH);
  });
  it('hat einen Ring aus Zone-2-Knoten mit Altbäumen und Rivalen', () => {
    const m = generateMap(3);
    const z2 = m.filter((n) => n.zone === 2);
    expect(z2.length).toBeGreaterThan(150);
    expect(z2.filter((n) => n.type === 'rivale').length).toBe(CONFIG.zone2.rivals);
    expect(z2.some((n) => n.type === 'altbaum')).toBe(true);
    for (const n of z2) expect(n.dist).toBeGreaterThanOrEqual(CONFIG.zone2.innerRadius - 1);
  });
  it('Zone-2-Knoten sind gesperrt, bis Zone 2 offen ist', () => {
    const s = newGame(1);
    connectN(s, 20);
    const z2 = s.nodes.find((n) => n.zone === 2 && n.type === 'laub')!;
    expect(findSource(s, z2.id)).toBeNull();
  });
});

describe('Zonenwechsel', () => {
  it('öffnet Zone 2 beim Erreichen der Schwelle', () => {
    const s = newGame(1);
    enterZone2(s);
    expect(connectedCount(s)).toBe(CONFIG.zone2.unlockAt);
    expect(s.zone).toBe(2);
    expect(s.zone2Since).not.toBeNull();
    expect(mods(s).reach).toBeGreaterThan(CONFIG.growth.reach + CONFIG.zone2.reachBonus - 1);
  });
  it('macht den Kostenanstieg in Zone 2 flacher', () => {
    const s = newGame(1);
    connectN(s, 40);
    const flat = CONFIG.growth.costPerUnit * 100 * CONFIG.growth.costPerNode ** 25 * CONFIG.zone2.costPerNode ** 15;
    // Formelprüfung über einen erreichbaren Knoten
    const q = s.nodes.map((n) => growthQuote(s, n.id)).find((x) => x && x.length > 0)!;
    expect(q.cost / q.length).toBeCloseTo(flat / 100, 6);
  });
});

describe('Jahreszeiten', () => {
  it('gibt es erst ab Zone 2, dann im Wechsel', () => {
    const s = newGame(1);
    expect(season(s)).toBeNull();
    s.zone = 2;
    s.zone2Since = 0;
    s.stats.playSeconds = 0;
    expect(season(s)).toBe('fruehling');
    s.stats.playSeconds = CONFIG.seasons.length * 2 + 1;
    expect(season(s)).toBe('herbst');
    s.stats.playSeconds = CONFIG.seasons.length * 4 + 1;
    expect(season(s)).toBe('fruehling');
  });
  it('Herbst verdoppelt Laub, Winter bremst', () => {
    const s = newGame(1);
    s.zone = 2;
    s.zone2Since = 0;
    s.stats.playSeconds = CONFIG.seasons.length * 2 + 1;
    expect(mods(s).laub).toBe(CONFIG.seasons.herbst.laub);
    s.stats.playSeconds = CONFIG.seasons.length * 3 + 1;
    expect(mods(s).global).toBeCloseTo(CONFIG.seasons.winter.global, 9);
  });
});

describe('Konkurrenzpilze', () => {
  it('bleiben ruhig in Zone 1', () => {
    const s = newGame(1);
    simulate(s, 3600, 1);
    expect(s.nodes.filter((n) => n.owner > 0 && n.type !== 'rivale').length).toBe(0);
  });
  it('besetzen in Zone 2 freie Knoten in ihrer Nähe', () => {
    const s = newGame(1);
    enterZone2(s);
    simulate(s, 1200, 1);
    const owned = s.nodes.filter((n) => n.owner > 0 && n.type !== 'rivale');
    expect(owned.length).toBeGreaterThan(0);
    for (const n of owned) expect(n.zone).toBe(2);
    expect(s.rivals.reduce((c, r) => c + r.edges.length, 0)).toBe(owned.length);
  });
  it('bleiben nicht stecken, sondern wachsen weiter', () => {
    const s = newGame(1);
    s.zone = 2;
    s.zone2Since = 0;
    for (const r of s.rivals) r.nextAt = 0;
    simulate(s, 3 * 3600, 1);
    // jeder Wald-Rivale hat sich deutlich ausgebreitet, keiner bleibt bei einer Handvoll Knoten stehen
    for (const r of s.rivals.filter((x) => s.nodes[x.core]!.zone === 2)) expect(r.edges.length).toBeGreaterThan(20);
  });
  it('besetzen nie Knoten des Spielers oder sein aktuelles Ziel', () => {
    const s = newGame(1);
    s.zone = 2;
    const core = s.nodes[s.rivals[0]!.core]!;
    const near = s.nodes.filter((n) => n.zone === 2 && n.type !== 'stein' && n.type !== 'rivale').sort((a, b) => Math.hypot(a.x - core.x, a.y - core.y) - Math.hypot(b.x - core.x, b.y - core.y));
    near[0]!.connected = true;
    s.growth = { from: 0, to: near[1]!.id, length: 1e9, progress: 0 };
    const claimed = rivalStep(s, 0);
    expect(claimed?.id).not.toBe(near[0]!.id);
    expect(claimed?.id).not.toBe(near[1]!.id);
  });
  it('Zurückerobern kostet mehr und befreit den Knoten', () => {
    const s = newGame(1);
    enterZone2(s);
    // Netz bis an den Rand von Zone 1 ausdehnen, dann einen Zone-2-Knoten als „besetzt“ markieren
    const target = s.nodes.filter((n) => n.zone === 2 && n.type !== 'rivale' && n.type !== 'stein').sort((a, b) => a.dist - b.dist)[0]!;
    const edge = s.nodes.filter((n) => n.zone === 1 && n.type !== 'stein').sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0]!;
    edge.connected = true;
    s.edges.push({ from: 0, to: edge.id });
    expect(findSource(s, target.id)).not.toBeNull();
    const normal = growthQuote(s, target.id)!.cost;
    target.owner = 1;
    s.rivals[0]!.edges.push({ from: s.rivals[0]!.core, to: target.id });
    expect(growthQuote(s, target.id)!.cost).toBeCloseTo(normal * CONFIG.rivals.reclaimCost, 6);
    expect(startGrowth(s, target.id)).toEqual({ ok: true });
    simulate(s, 600, 0.5);
    expect(s.nodes[target.id]!.connected).toBe(true);
    expect(s.nodes[target.id]!.owner).toBe(0);
    expect(s.rivals[0]!.edges.some((e) => e.to === target.id)).toBe(false);
  });
  it('Kappen einer Rivalen-Leitung befreit den ganzen Ast dahinter', () => {
    const s = newGame(1);
    enterZone2(s);
    simulate(s, 3000, 1);
    const r = s.rivals.find((x) => x.edges.length >= 3)!;
    const idx = s.rivals.indexOf(r);
    // erster Knoten direkt am Kern, an dem weitere hängen
    const first = r.edges.find((e) => e.from === r.core && r.edges.some((f) => f.from === e.to))!;
    const target = s.nodes[first.to]!;
    s.nodes.push({ ...target, id: s.nodes.length, type: 'laub', x: target.x + 40, y: target.y + 40, connected: true, owner: 0, r: 9 });
    s.events.nextAt = 1e9;
    for (const x of s.rivals) x.nextAt = 1e9;
    s.res.n = 1e30;
    expect(startGrowth(s, target.id)).toEqual({ ok: true });
    simulate(s, 600, 0.5);
    expect(target.owner).toBe(0);
    // jeder verbliebene Rivalen-Knoten hängt noch am Kern
    const owned = s.nodes.filter((n) => n.owner === idx + 1 && n.type !== 'rivale');
    expect(owned.length).toBe(r.edges.length);
    for (const e of r.edges) expect(e.to).not.toBe(target.id);
  });
  it('Kern erobern besiegt den Rivalen und befreit alle seine Knoten', () => {
    const s = newGame(1);
    enterZone2(s);
    simulate(s, 900, 1);
    const r = s.rivals[0]!;
    const core = s.nodes[r.core]!;
    // Spieler-Knoten direkt neben den Kern setzen
    s.nodes.push({ ...core, id: s.nodes.length, type: 'laub', x: core.x + 60, y: core.y, connected: true, owner: 0, r: 9 });
    s.events.nextAt = 1e9;
    expect(startGrowth(s, core.id)).toEqual({ ok: true });
    const before = s.stats.totalN;
    simulate(s, 600, 0.5);
    expect(r.alive).toBe(false);
    expect(s.nodes.filter((n) => n.owner === 1).length).toBe(0);
    expect(s.meta.lifetime.rivalsBeaten).toBe(1);
    expect(s.nodes[core.id]!.connected).toBe(true);
    // Belohnung: mindestens 5 Minuten Produktion auf einen Schlag
    expect(s.stats.totalN - before).toBeGreaterThan(100);
  });
});

describe('Spielstand v3', () => {
  it('speichert Zone, Besitz und Rivalen verlustfrei', () => {
    const s = newGame(1);
    enterZone2(s);
    simulate(s, 1500, 1);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(s, 0))));
    expect(back).toEqual(s);
  });
  it('lädt weiterhin einen v1-Spielstand', () => {
    const s = deserialize(v1Save);
    expect(s.zone).toBe(1);
    expect(s.rivals.length).toBe(CONFIG.zone2.rivals + CONFIG.zone3.rivals);
    expect(s.edges.length).toBe(18);
  });
});
