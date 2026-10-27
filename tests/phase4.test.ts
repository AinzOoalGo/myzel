import { describe, expect, it } from 'bun:test';
import { CONFIG } from '../src/core/config';
import {
  buyGenome,
  canPrestige,
  catchGolden,
  computeRates,
  genomeAvailable,
  growthCost,
  newGame,
  prestige,
  reach,
  simulate,
  sporeGain,
  tap,
  tapValue,
  type GameState,
} from '../src/core/game';
import { checkAchievements } from '../src/core/achievements';
import { applyOffline, deserialize, serialize } from '../src/core/save';
// Echter Spielstand aus Version 0.2 (Format v1)
import v1Save from './fixtures/save-v1.json';

const connectN = (s: GameState, count: number) => {
  const ids = s.nodes
    .filter((n) => !n.connected && n.type !== 'stein')
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((n) => n.id);
  for (const id of ids) {
    s.nodes[id]!.connected = true;
    s.edges.push({ from: 0, to: id });
  }
};

describe('Sporenflug', () => {
  it('erst ab genug Knoten und Sporen möglich', () => {
    const s = newGame(1);
    expect(canPrestige(s)).toBe(false);
    connectN(s, CONFIG.prestige.minNodes);
    expect(canPrestige(s)).toBe(false); // noch keine Nährstoffe verdient
    s.stats.totalN = CONFIG.prestige.divisor * 9;
    expect(sporeGain(s)).toBe(3);
    expect(canPrestige(s)).toBe(true);
  });
  it('setzt den Wald zurück, behält Meta-Daten und gibt Sporen', () => {
    const s = newGame(1);
    connectN(s, 20);
    s.stats.totalN = CONFIG.prestige.divisor * 16;
    s.meta.achievements.push('first_link');
    s.res.n = 999;
    s.levels.hyphen = 7;
    const next = prestige(s, 2)!;
    expect(next.seed).toBe(2);
    expect(next.res.n).toBe(0);
    expect(next.levels.hyphen).toBe(0);
    expect(next.edges.length).toBe(0);
    expect(next.meta.spores).toBe(4);
    expect(next.meta.sporesTotal).toBe(4);
    expect(next.meta.runs).toBe(1);
    expect(next.meta.achievements).toEqual(['first_link']);
  });
  it('Sporen geben dauerhaft +2 % je Spore', () => {
    const s = newGame(1);
    const base = tapValue(s);
    s.meta.sporesTotal = 10;
    expect(tapValue(s)).toBeCloseTo(base * 1.2, 9);
  });
  it('ist unmöglich, wenn die Bedingungen fehlen', () => {
    expect(prestige(newGame(1))).toBeNull();
  });
});

describe('Genom-Baum', () => {
  it('Stufen bauen aufeinander auf und kosten Sporen', () => {
    const s = newGame(1);
    s.meta.spores = 3;
    expect(genomeAvailable(s, 'p2')).toBe(false);
    expect(buyGenome(s, 'p2')).toBe(false);
    expect(buyGenome(s, 'p1')).toBe(true);
    expect(s.meta.spores).toBe(2);
    expect(genomeAvailable(s, 'p2')).toBe(true);
    expect(buyGenome(s, 'p2')).toBe(false); // kostet 3
    expect(buyGenome(s, 'p1')).toBe(false); // schon gekauft
  });
  it('Mutationen wirken', () => {
    const s = newGame(1);
    const cost = growthCost(s, 100);
    const r = reach(s);
    const tv = tapValue(s);
    s.meta.genome.push('p1', 'p2', 'z3');
    expect(growthCost(s, 100)).toBeCloseTo(cost * CONFIG.genomeEffects.p1Cost, 9);
    expect(reach(s)).toBe(r + CONFIG.genomeEffects.p2Reach);
    expect(tapValue(s)).toBe(tv * CONFIG.genomeEffects.z3Tap);
  });
  it('Startkapital gilt im nächsten Durchlauf', () => {
    const s = newGame(1);
    s.meta.genome.push('p4');
    connectN(s, 20);
    s.stats.totalN = 1e6;
    expect(prestige(s, 3)!.res.n).toBe(CONFIG.genomeEffects.p4Start);
  });
  it('Langer Schlaf verlängert die Offline-Zeit', () => {
    const s = newGame(1);
    s.meta.genome.push('s3');
    expect(applyOffline(s, 0, 48 * 3600 * 1000).seconds).toBe(CONFIG.genomeEffects.s3Offline);
  });
});

describe('Ereignisse', () => {
  it('treten nach der ersten Wartezeit auf und wechseln sich ab', () => {
    const s = newGame(1);
    connectN(s, 5);
    let seen = 0;
    let last = -1;
    for (let t = 0; t < 3600; t++) {
      simulate(s, 1, 0.5);
      if (s.events.counter !== last) {
        last = s.events.counter;
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
  it('Regen verdoppelt das Wachstum', () => {
    const s = newGame(1);
    s.res.n = 1e6;
    s.growth = { from: 0, to: 1, length: 1e9, progress: 0 };
    s.events.nextAt = 1e9;
    simulate(s, 1, 1);
    const normal = s.growth.progress;
    s.events.active = { type: 'regen', until: 1e9 };
    simulate(s, 1, 1);
    expect(s.growth.progress - normal).toBeCloseTo(normal * CONFIG.events.regen.growth, 6);
  });
  it('Dürre bremst Wasser, offline aber schwächer', () => {
    const s = newGame(1);
    connectN(s, 8);
    s.events.nextAt = 1e9;
    const normal = computeRates(s).waterIn;
    s.events.active = { type: 'duerre', until: 1e9 };
    expect(computeRates(s).waterIn).toBeCloseTo(normal * CONFIG.events.duerre.water, 9);
    expect(computeRates(s, 1, true).waterIn).toBeCloseTo(normal * CONFIG.events.duerre.offlineWater, 9);
  });
  it('goldener Fruchtkörper erscheint nie offline', () => {
    const s = newGame(1);
    connectN(s, 5);
    simulate(s, 6 * 3600, 1, true);
    expect(s.events.golden).toBeNull();
  });
  it('goldener Fruchtkörper gibt Bonus genau einmal', () => {
    const s = newGame(1);
    connectN(s, 5);
    s.events.golden = { x: 0, y: 0, until: 1e9 };
    const r = catchGolden(s);
    expect(r).toBeGreaterThan(0);
    expect(s.res.n).toBeCloseTo(r, 9);
    expect(catchGolden(s)).toBe(0);
    expect(s.meta.lifetime.goldCaught).toBe(1);
  });
});

describe('Erfolge', () => {
  it('werden einmalig freigeschaltet und geben Bonus', () => {
    const s = newGame(1);
    const base = tapValue(s);
    for (let i = 0; i < 100; i++) tap(s);
    const fresh = checkAchievements(s);
    expect(fresh).toContain('taps_100');
    expect(checkAchievements(s)).not.toContain('taps_100');
    expect(tapValue(s)).toBeCloseTo(base * (1 + CONFIG.achievementBonus * s.meta.achievements.length), 9);
  });
});

describe('Spielstand v2', () => {
  it('lädt einen echten v1-Spielstand verlustfrei', () => {
    const s = deserialize(v1Save);
    expect(s.edges.length).toBe(18);
    expect(s.levels.hyphen).toBe((v1Save as { levels: { hyphen: number } }).levels.hyphen);
    expect(s.meta.spores).toBe(0);
    expect(s.meta.lifetime.totalN).toBeGreaterThan(0);
    expect(s.events.active).toBeNull();
  });
  it('speichert Meta-Daten und Ereignisse mit', () => {
    const s = newGame(8);
    s.meta.spores = 5;
    s.meta.genome.push('z1');
    s.meta.achievements.push('rain');
    s.events.active = { type: 'regen', until: 99 };
    expect(deserialize(JSON.parse(JSON.stringify(serialize(s, 0))))).toEqual(s);
  });
  it('ignoriert unbekannte Mutationen aus manipulierten Ständen', () => {
    const raw = serialize(newGame(8), 0) as unknown as { meta: { genome: string[] } };
    raw.meta.genome = ['z1', 'hack'];
    expect(deserialize(raw).meta.genome).toEqual(['z1']);
  });
});
