import { describe, expect, it } from 'bun:test';
import { CONFIG } from '../src/core/config';
import { generateMap, isOcean, planetGeography, segmentCrossesOcean } from '../src/core/map';
import {
  boss,
  buy,
  buyGenome,
  checkPlanetDone,
  computeRates,
  connectedCount,
  genomeAvailable,
  growthCost,
  growthQuote,
  newGame,
  simulate,
  startGrowth,
  type GameState,
} from '../src/core/game';
import { checkAchievements } from '../src/core/achievements';
import { makeQuests } from '../src/core/daily';
import { deserialize, serialize } from '../src/core/save';

/** Fingerabdruck von Zone 1–3 aus Version 1.2.3 (vor Zone 4) – alte Spielstände müssen gültig bleiben */
const OLD_Z123: Record<number, [number, number]> = { 1: [2542915073, 675], 777: [2092023768, 675], 12345: [2140000688, 675] };
const fingerprint = (seed: number): [number, number] => {
  let h = 0;
  const m = generateMap(seed).filter((n) => n.zone <= 3);
  for (const c of m.map((n) => `${n.type}:${n.x.toFixed(3)},${n.y.toFixed(3)}:${n.climate}`).join('|')) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return [h, m.length];
};

/** Fingerabdruck von Zone 4 aus Version 1.3 – darf sich nie mehr ändern (Spielstände speichern nur Knoten-IDs) */
const Z4: Record<number, [number, number]> = { 1: [2460346848, 231], 777: [1900616828, 232], 12345: [437921926, 234] };
const fingerprint4 = (seed: number): [number, number] => {
  let h = 0;
  const m = generateMap(seed).filter((n) => n.zone === 4);
  for (const c of m.map((n) => `${n.type}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).join('|')) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return [h, m.length];
};

const connect = (s: GameState, ids: number[]) => {
  for (const id of ids) {
    s.nodes[id]!.connected = true;
    s.edges.push({ from: 0, to: id });
  }
};

/** Spiel mit 100 Knoten aus Zone 1–3 und offenem Planeten */
const zone4Game = (seed = 1) => {
  const s = newGame(seed);
  const ids = s.nodes
    .filter((n) => n.zone <= 3 && n.type !== 'stein' && n.type !== 'rivale')
    .sort((a, b) => b.dist - a.dist) // die äußersten, damit die Küste erreichbar ist
    .slice(0, CONFIG.zone4.unlockAt)
    .map((n) => n.id);
  connect(s, ids);
  s.zone = 4;
  s.zone2Since = 0;
  s.meta.lifetime.maxZone = 4;
  s.events.nextAt = 1e12;
  for (const r of s.rivals) r.nextAt = 1e12;
  return s;
};

describe('Karte mit Zone 4', () => {
  it('Zone 1–3 sind exakt wie vor dem Update', () => {
    for (const seed of [1, 777, 12345]) expect(fingerprint(seed)).toEqual(OLD_Z123[seed]!);
  });
  it('Zone 4 bleibt so, wie sie in 1.3 erschienen ist', () => {
    for (const seed of [1, 777, 12345]) expect(fingerprint4(seed)).toEqual(Z4[seed]!);
  });
  it('hat Kontinente, Meer, alle neuen Knoten und genau einen Schleimpilz', () => {
    for (const seed of [1, 2, 3]) {
      const m = generateMap(seed);
      const geo = planetGeography(seed);
      const z4 = m.filter((n) => n.zone === 4);
      expect(geo.length).toBe(CONFIG.zone4.continents);
      expect(z4.filter((n) => n.type === 'rivale').length).toBe(1);
      for (const t of ['vulkan', 'urwald', 'koralle', 'mineral', 'laub']) expect(z4.some((n) => n.type === t)).toBe(true);
      // Riffe liegen im Meer, alles andere an Land
      for (const n of z4) expect(isOcean(geo, n.x, n.y)).toBe(n.type === 'koralle');
    }
  });
  it('der Heimatkontinent ist Land, dazwischen Meer', () => {
    const geo = planetGeography(1);
    expect(isOcean(geo, 0, 0)).toBe(false);
    expect(isOcean(geo, CONFIG.zone3.outerRadius, 0)).toBe(false);
    // von der Mitte ganz nach außen muss man irgendwo übers Wasser
    expect(segmentCrossesOcean(geo, 0, 0, 20000, 0)).toBe(true);
  });
  it('fast alle Planeten-Knoten sind mit normaler Reichweite erreichbar (Riff-Ketten)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const m = generateMap(seed);
      const R = 1600;
      const seen = new Set(m.filter((n) => n.zone <= 3 && n.type !== 'stein').map((n) => n.id));
      const z4 = m.filter((n) => n.zone === 4 && n.type !== 'stein');
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of z4) {
          if (seen.has(n.id)) continue;
          for (const id of seen) {
            const o = m[id]!;
            if (Math.hypot(o.x - n.x, o.y - n.y) <= R) {
              seen.add(n.id);
              grew = true;
              break;
            }
          }
        }
      }
      const reached = z4.filter((n) => seen.has(n.id));
      expect(reached.length / z4.length).toBeGreaterThan(0.85);
      // der Schleimpilz ist immer erreichbar
      expect(reached.some((n) => n.type === 'rivale')).toBe(true);
    }
  });
});

describe('Spiel auf dem Planeten', () => {
  it('öffnet Zone 4 bei 100 Knoten und weckt den Schleimpilz', () => {
    const s = newGame(1);
    const ids = s.nodes
      .filter((n) => n.zone <= 3 && n.type !== 'stein' && n.type !== 'rivale')
      .sort((a, b) => b.dist - a.dist)
      .slice(0, CONFIG.zone4.unlockAt - 1)
      .map((n) => n.id);
    connect(s, ids);
    s.zone = 3;
    s.zone2Since = 0;
    const next = s.nodes.find((n) => !n.connected && n.zone <= 3 && growthQuote(s, n.id))!;
    s.res.n = 1e40;
    expect(startGrowth(s, next.id).ok).toBe(true);
    simulate(s, 3600, 1);
    expect(s.zone).toBe(4);
    expect(s.meta.lifetime.maxZone).toBe(4);
    expect(s.meta.track.run.zone4At).not.toBeNull();
    // der Schleimpilz breitet sich auf seinem Kontinent aus
    simulate(s, 3600, 1);
    expect(boss(s)!.edges.length).toBeGreaterThan(3);
  });
  it('übers Meer geht es nur mit Tiefsee-Hyphen – teurer und langsamer', () => {
    const s = zone4Game();
    const target = s.nodes.filter((n) => n.zone === 4 && n.type === 'koralle').sort((a, b) => a.dist - b.dist)[0]!;
    expect(growthQuote(s, target.id)).toBeNull();
    s.res.sugar = 1e9;
    expect(buy(s, 'tiefsee')).toBe(true);
    const q = growthQuote(s, target.id)!;
    expect(q).not.toBeNull();
    expect(q.ocean).toBe(true);
    expect(q.cost / growthCost(s, q.length, target)).toBeCloseTo(CONFIG.zone4.oceanCost, 6);
    // zweite Stufe: billiger
    expect(buy(s, 'tiefsee')).toBe(true);
    expect(growthQuote(s, target.id)!.cost).toBeLessThan(q.cost);
    s.res.n = 1e40;
    expect(startGrowth(s, target.id).ok).toBe(true);
    expect(s.growth!.ocean).toBe(true);
  });
  it('der Schleimpilz kann nicht schwimmen', () => {
    const s = zone4Game(2);
    for (const r of s.rivals) r.nextAt = 0;
    simulate(s, 6 * 3600, 2);
    const b = boss(s)!;
    const idx = s.rivals.indexOf(b) + 1;
    const owned = s.nodes.filter((n) => n.owner === idx && n.type !== 'rivale');
    expect(owned.length).toBeGreaterThan(5);
    expect(owned.some((n) => n.type === 'koralle')).toBe(false);
    const geo = planetGeography(2);
    for (const e of b.edges) {
      const a = s.nodes[e.from]!;
      const t = s.nodes[e.to]!;
      expect(segmentCrossesOcean(geo, a.x, a.y, t.x, t.y)).toBe(false);
    }
  });
  it('Kern des Schleimpilzes kostet ×10, Sieg gibt große Belohnung', () => {
    const s = zone4Game();
    s.levels.tiefsee = 1;
    const b = boss(s)!;
    const core = s.nodes[b.core]!;
    const base = growthCost(s, 1000);
    expect(growthCost(s, 1000, core)).toBeCloseTo(base * CONFIG.zone4.boss.coreCost, 6);
    // direkt neben den Kern setzen und angreifen
    const near = s.nodes.filter((n) => n.zone === 4 && n.type !== 'stein' && n.id !== core.id).sort((a, c) => Math.hypot(a.x - core.x, a.y - core.y) - Math.hypot(c.x - core.x, c.y - core.y))[0]!;
    near.owner = 0;
    connect(s, [near.id]);
    s.res.n = 1e40;
    const before = s.stats.totalN;
    expect(startGrowth(s, core.id).ok).toBe(true);
    simulate(s, 3600, 1);
    expect(b.alive).toBe(false);
    expect(s.meta.lifetime.bossBeaten).toBe(1);
    expect(s.stats.totalN - before).toBeGreaterThan(computeRates(s).n * 1000);
    expect(checkAchievements(s)).toContain('boss');
  });
  it('Finale erst mit 150 Knoten UND besiegtem Schleimpilz', () => {
    const s = zone4Game();
    const more = s.nodes
      .filter((n) => !n.connected && n.zone === 4 && n.type !== 'stein' && n.type !== 'rivale')
      .slice(0, CONFIG.zone4.goal - connectedCount(s))
      .map((n) => n.id);
    connect(s, more);
    expect(connectedCount(s)).toBe(CONFIG.zone4.goal);
    expect(checkPlanetDone(s)).toBe(false);
    expect(s.stats.zone4DoneAt).toBeNull();
    boss(s)!.alive = false;
    expect(checkPlanetDone(s)).toBe(true);
    expect(s.stats.zone4DoneAt).not.toBeNull();
    expect(s.meta.lifetime.planets).toBe(1);
    expect(checkPlanetDone(s)).toBe(false); // nur einmal
    expect(checkAchievements(s)).toContain('planet');
  });
  it('Vulkane liefern Mineralien nur mit Wasser', () => {
    const s = zone4Game();
    for (const n of s.nodes) if (n.connected && n.type !== 'spore') n.connected = false;
    const v = s.nodes.find((n) => n.zone === 4 && n.type === 'vulkan')!;
    connect(s, [v.id]);
    s.res.water = 0;
    expect(computeRates(s).minerals).toBe(0);
    const w = s.nodes.find((n) => n.zone === 4 && n.type === 'feucht')!;
    connect(s, [w.id]);
    expect(computeRates(s).minerals).toBeGreaterThan(0);
  });
  it('Ast „Weltenpilz“ erst nach dem ersten Besuch auf dem Planeten', () => {
    const s = newGame(1);
    s.meta.spores = 1e9;
    expect(genomeAvailable(s, 'o1')).toBe(false);
    s.meta.lifetime.maxZone = 4;
    expect(genomeAvailable(s, 'o1')).toBe(true);
    expect(buyGenome(s, 'o1')).toBe(true);
    expect(genomeAvailable(s, 'o2')).toBe(true);
  });
  it('Tagesaufgaben auf dem Planeten können die neuen Knoten verlangen', () => {
    const types = new Set<string>();
    for (let d = 1; d <= 28; d++) for (const q of makeQuests(`2026-11-${String(d).padStart(2, '0')}`, 4)) if (q.nodeType) types.add(q.nodeType);
    expect(['koralle', 'vulkan', 'urwald'].some((t) => types.has(t))).toBe(true);
  });
});

describe('Spielstand v7', () => {
  it('speichert den Planeten verlustfrei', () => {
    const s = zone4Game();
    s.res.sugar = 5000;
    expect(buy(s, 'tiefsee')).toBe(true);
    s.levels.planet = 2;
    for (const r of s.rivals) r.nextAt = 0;
    simulate(s, 1800, 1);
    s.meta.lifetime.bossBeaten = 1;
    s.meta.lifetime.planets = 2;
    s.stats.zone4DoneAt = 1234;
    s.meta.track.run.zone4At = 99;
    const back = deserialize(JSON.parse(JSON.stringify(serialize(s, 0))));
    expect(back).toEqual(s);
  });
  it('alter v6-Spielstand mit 100 Knoten landet direkt auf dem Planeten', () => {
    const s = zone4Game();
    s.zone = 3;
    s.meta.lifetime.maxZone = 3;
    const raw = JSON.parse(JSON.stringify(serialize(s, 0)));
    raw.v = 6;
    delete raw.levels.tiefsee;
    delete raw.levels.planet;
    delete raw.stats.zone4DoneAt;
    delete raw.meta.lifetime.bossBeaten;
    delete raw.meta.lifetime.planets;
    delete raw.meta.lifetime.maxZone;
    raw.rivals = raw.rivals.slice(0, 5); // v6 kannte nur 5 Rivalen
    const back = deserialize(raw);
    expect(back.zone).toBe(4);
    expect(back.meta.lifetime.maxZone).toBe(4);
    expect(back.levels.tiefsee).toBe(0);
    expect(back.stats.zone4DoneAt).toBeNull();
    expect(boss(back)!.alive).toBe(true);
    expect(boss(back)!.reach).toBe(CONFIG.zone4.boss.reach);
  });
});
