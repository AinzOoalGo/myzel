import { describe, expect, it } from 'bun:test';
import { CONFIG } from '../src/core/config';
import { climateAt, generateMap } from '../src/core/map';
import {
  buy,
  canBuy,
  computeRates,
  connectedCount,
  findSource,
  growthQuote,
  hexBonus,
  mods,
  newGame,
  rivalStep,
  simulate,
  sporeGain,
  startGrowth,
  type GameState,
} from '../src/core/game';
import { checkAchievements } from '../src/core/achievements';
import { deserialize, serialize } from '../src/core/save';
import v1Save from './fixtures/save-v1.json';

/** Fingerabdruck von Zone 1 + 2 aus Version 1.0 (vor Zone 3) – alte Spielstände müssen gültig bleiben */
const OLD_Z12 = { 12345: 1797047397, 1: 1803916465 } as const;
const fingerprint = (seed: number) => {
  let h = 0;
  const m = generateMap(seed).filter((n) => n.zone <= 2);
  for (const c of m.map((n) => `${n.type}:${n.x.toFixed(3)},${n.y.toFixed(3)}`).join('|')) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return h;
};

/** verbindet Knoten direkt (Testhilfe) */
const connect = (s: GameState, ids: number[]) => {
  for (const id of ids) {
    s.nodes[id]!.connected = true;
    s.edges.push({ from: 0, to: id });
  }
};
const nearestOf = (s: GameState, type: string, zone = 3) =>
  s.nodes.filter((n) => n.type === type && n.zone === zone && !n.connected).sort((a, b) => a.dist - b.dist)[0]!;

/** Spiel mit 60 Knoten und offener Zone 3 */
const zone3Game = (seed = 1) => {
  const s = newGame(seed);
  const ids = s.nodes
    .filter((n) => n.zone <= 2 && !n.connected && n.type !== 'stein' && n.type !== 'rivale')
    .sort((a, b) => a.dist - b.dist)
    .slice(0, CONFIG.zone3.unlockAt)
    .map((n) => n.id);
  connect(s, ids);
  s.zone = 3;
  s.zone2Since = 0;
  s.events.nextAt = 1e12;
  return s;
};

describe('Karte mit Zone 3', () => {
  it('Zone 1 und 2 sind exakt wie in Version 1.0', () => {
    expect(fingerprint(12345)).toBe(OLD_Z12[12345]);
    expect(fingerprint(1)).toBe(OLD_Z12[1]);
  });
  it('hat einen äußeren Ring mit allen neuen Knotenarten und zwei Rivalen', () => {
    const z3 = generateMap(3).filter((n) => n.zone === 3);
    expect(z3.length).toBeGreaterThan(150);
    for (const t of ['moor', 'mineral', 'hexenring', 'rivale']) expect(z3.some((n) => n.type === t)).toBe(true);
    expect(z3.filter((n) => n.type === 'rivale').length).toBe(CONFIG.zone3.rivals);
    for (const n of z3) {
      expect(n.dist).toBeGreaterThanOrEqual(CONFIG.zone3.innerRadius - 1);
      expect(n.climate).not.toBeNull();
    }
  });
  it('verteilt alle drei Klimazonen nach Himmelsrichtung', () => {
    const z3 = generateMap(3).filter((n) => n.zone === 3);
    expect(new Set(z3.map((n) => n.climate)).size).toBe(3);
    expect(climateAt(1, 0, 0)).toBe('tropen');
    expect(climateAt(-1, 0.01, 0)).toBe('steppe');
    expect(climateAt(0.3, -1, 0)).toBe('taiga');
  });
});

describe('Zonenwechsel 2 → 3', () => {
  it('öffnet Zone 3 bei 60 Knoten und erhöht Reichweite und Tempo', () => {
    const s = newGame(1);
    const ids = s.nodes
      .filter((n) => n.zone <= 2 && !n.connected && n.type !== 'stein' && n.type !== 'rivale')
      .sort((a, b) => a.dist - b.dist)
      .slice(0, CONFIG.zone3.unlockAt - 1)
      .map((n) => n.id);
    connect(s, ids);
    s.zone = 2;
    s.zone2Since = 0;
    const reach2 = mods(s).reach;
    const target = s.nodes.find((n) => findSource(s, n.id))!;
    s.res.n = 1e40;
    expect(startGrowth(s, target.id)).toEqual({ ok: true });
    simulate(s, 600, 0.5);
    expect(connectedCount(s)).toBe(CONFIG.zone3.unlockAt);
    expect(s.zone).toBe(3);
    expect(mods(s).reach).toBe(reach2 + CONFIG.zone3.reachBonus);
  });
  it('Zone-3-Knoten sind vorher gesperrt', () => {
    const s = zone3Game();
    s.zone = 2;
    expect(findSource(s, nearestOf(s, 'laub').id)).toBeNull();
  });
});

describe('Neue Knoten', () => {
  it('Moor liefert viel Wasser und etwas Nährstoffe', () => {
    const s = zone3Game();
    const before = computeRates(s);
    connect(s, [nearestOf(s, 'moor').id]);
    const after = computeRates(s);
    expect(after.waterIn).toBeGreaterThan(before.waterIn + 1);
    expect(after.n).toBeGreaterThan(before.n);
  });
  it('Mineraladern liefern Mineralien und schalten die neuen Upgrades frei', () => {
    const s = zone3Game();
    expect(canBuy(s, 'kristall')).toBe(false);
    connect(s, [nearestOf(s, 'mineral').id]);
    expect(computeRates(s).minerals).toBeGreaterThan(0);
    simulate(s, 600, 1);
    expect(s.res.minerals).toBeGreaterThan(CONFIG.upgrades.find((u) => u.id === 'kristall')!.baseCost.min);
    const g = mods(s).global;
    expect(buy(s, 'kristall')).toBe(true);
    expect(mods(s).global).toBeCloseTo(g * (1 + CONFIG.effects.kristallGlobal), 9);
  });
  it('Fernsporen erhöhen die Reichweite in Zone 3', () => {
    const s = zone3Game();
    connect(s, [nearestOf(s, 'mineral').id]);
    s.res.minerals = 1e6;
    const r = mods(s).reach;
    buy(s, 'fern');
    expect(mods(s).reach).toBe(r + CONFIG.effects.fernReach);
  });
  it('Hexenringe erhöhen den Sporengewinn, mit „Hexenmeister“ doppelt', () => {
    const s = zone3Game();
    s.stats.totalN = CONFIG.prestige.divisor * 400; // ergibt 20 Sporen
    expect(sporeGain(s)).toBe(20);
    connect(s, [nearestOf(s, 'hexenring').id]);
    expect(hexBonus(s)).toBeCloseTo(1.25, 9);
    expect(sporeGain(s)).toBe(25);
    s.meta.genome.push('w3');
    expect(sporeGain(s)).toBe(30);
  });
});

describe('Klima', () => {
  it('Tropen bringen mehr, Taiga weniger als Steppe', () => {
    const s = zone3Game();
    const laub = s.nodes.filter((n) => n.zone === 3 && n.type === 'laub');
    const y = (c: string) => {
      const n = laub.find((x) => x.climate === c)!;
      // gleiche Entfernung annehmen, um nur das Klima zu vergleichen
      return CONFIG.zone3.climate[n.climate!].yield;
    };
    expect(y('tropen')).toBeGreaterThan(y('steppe'));
    expect(y('taiga')).toBeLessThan(y('steppe'));
  });
  it('Taiga-Wasser ist gegen Dürre geschützt', () => {
    const s = zone3Game();
    const taigaWater = s.nodes.find((n) => n.zone === 3 && (n.type === 'feucht' || n.type === 'moor') && n.climate === 'taiga');
    if (!taigaWater) return; // auf dieser Karte keine Taiga-Wasserstelle
    s.nodes.forEach((n) => {
      if (n.type === 'feucht') n.connected = false;
    });
    connect(s, [taigaWater.id]);
    const normal = computeRates(s).waterIn;
    s.events.active = { type: 'duerre', until: 1e12 };
    expect(computeRates(s).waterIn).toBeCloseTo(normal, 9);
  });
});

describe('Sporenwind', () => {
  it('macht Fäden viel billiger, solange er weht', () => {
    const s = zone3Game();
    const t = s.nodes.find((n) => findSource(s, n.id))!;
    const normal = growthQuote(s, t.id)!.cost;
    expect(normal).toBeGreaterThan(0);
    s.events.active = { type: 'wind', until: s.stats.playSeconds + 30 };
    expect(growthQuote(s, t.id)!.cost).toBeCloseTo(normal * CONFIG.events.wind.cost, 6);
  });
  it('kommt nur ab Zone 3 vor', () => {
    const s = newGame(1);
    s.events.nextAt = 0;
    let wind = false;
    for (let i = 0; i < 4000; i++) {
      simulate(s, 10, 1);
      if (s.events.active?.type === 'wind') wind = true;
    }
    expect(wind).toBe(false);
  });
});

describe('Zone-3-Rivalen', () => {
  it('bleiben in Zone 3 und starten erst mit Zone 3', () => {
    const s = zone3Game();
    const idx = s.rivals.findIndex((r) => s.nodes[r.core]!.zone === 3);
    expect(idx).toBeGreaterThanOrEqual(0);
    for (const r of s.rivals) r.nextAt = 0;
    simulate(s, 2 * 3600, 1);
    const owned3 = s.nodes.filter((n) => n.owner === idx + 1 && n.type !== 'rivale');
    expect(owned3.length).toBeGreaterThan(5);
    for (const n of owned3) expect(n.zone).toBe(3);
  });
  it('rivalStep eines Zone-3-Rivalen nimmt nie Zone-2-Knoten', () => {
    const s = zone3Game();
    const idx = s.rivals.findIndex((r) => s.nodes[r.core]!.zone === 3);
    for (let i = 0; i < 30; i++) {
      const n = rivalStep(s, idx);
      if (n) expect(n.zone).toBe(3);
    }
  });
});

describe('Erfolge und Spielstand v4', () => {
  it('neue Erfolge werden erkannt', () => {
    const s = zone3Game();
    connect(s, [nearestOf(s, 'moor').id, nearestOf(s, 'hexenring').id]);
    const got = checkAchievements(s);
    for (const id of ['zone3', 'moor', 'hexenring']) expect(got).toContain(id);
  });
  it('speichert Zone 3, Mineralien und neue Upgrades verlustfrei', () => {
    const s = zone3Game();
    connect(s, [nearestOf(s, 'mineral').id]);
    s.res.minerals = 1234;
    s.levels.kristall = 3;
    s.levels.fern = 2;
    s.meta.genome.push('w1');
    s.meta.lifetime.maxZone = 3;
    for (const r of s.rivals) r.nextAt = 0;
    simulate(s, 1800, 1);
    expect(deserialize(JSON.parse(JSON.stringify(serialize(s, 0))))).toEqual(s);
  });
  it('alter v1-Spielstand lädt weiterhin', () => {
    const s = deserialize(v1Save);
    expect(s.edges.length).toBe(18);
    expect(s.res.minerals).toBe(0);
    expect(s.levels.kristall).toBe(0);
    expect(s.rivals.length).toBe(CONFIG.zone2.rivals + CONFIG.zone3.rivals + 1); // + Riesen-Schleimpilz (Zone 4)
  });
});
