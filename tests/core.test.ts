import { describe, expect, it } from 'bun:test';
import { CONFIG } from '../src/core/config';
import { generateMap } from '../src/core/map';
import {
  buy,
  computeRates,
  connectedCount,
  findSource,
  growthQuote,
  newGame,
  simulate,
  startGrowth,
  tap,
  tick,
  upgradeCost,
  type GameState,
} from '../src/core/game';
import { applyOffline, deserialize, exportString, importString, serialize } from '../src/core/save';
import { formatDuration, formatNumber } from '../src/core/format';

const nearest = (s: GameState, type: string) =>
  s.nodes.filter((n) => n.type === type && !n.connected).sort((a, b) => a.dist - b.dist)[0]!;

/** Verbindet einen Knoten direkt (Testhilfe, umgeht Kosten). */
const connect = (s: GameState, id: number) => {
  s.nodes[id]!.connected = true;
  s.edges.push({ from: 0, to: id });
};

describe('Karte', () => {
  it('ist deterministisch für denselben Seed', () => {
    expect(generateMap(42)).toEqual(generateMap(42));
  });
  it('unterscheidet sich für verschiedene Seeds', () => {
    expect(generateMap(1)[10]!.x).not.toBe(generateMap(2)[10]!.x);
  });
  it('startet mit der Spore im Zentrum und hält Mindestabstände ein', () => {
    const m = generateMap(7);
    expect(m[0]!.type).toBe('spore');
    expect(m[0]!.connected).toBe(true);
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++)
        expect(Math.hypot(m[i]!.x - m[j]!.x, m[i]!.y - m[j]!.y)).toBeGreaterThanOrEqual(CONFIG.map.minSpacing - 1e-9);
  });
  it('setzt keine Steine in den Startbereich', () => {
    for (const n of generateMap(3)) if (n.type === 'stein') expect(n.dist).toBeGreaterThanOrEqual(CONFIG.map.rockFreeRadius);
  });
  it('hat erreichbare Knoten direkt am Start', () => {
    const s = newGame(5);
    expect(s.nodes.filter((n) => findSource(s, n.id)).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Tippen und Wachsen', () => {
  it('Tippen bringt Nährstoffe', () => {
    const s = newGame(1);
    expect(tap(s)).toBe(1);
    expect(s.res.n).toBe(1);
    expect(s.stats.taps).toBe(1);
  });
  it('Wachstum kostet, braucht Zeit und verbindet dann', () => {
    const s = newGame(1);
    const laub = nearest(s, 'laub');
    const q = growthQuote(s, laub.id)!;
    s.res.n = q.cost - 1;
    expect(startGrowth(s, laub.id)).toEqual({ ok: false, reason: 'cost' });
    s.res.n = q.cost;
    expect(startGrowth(s, laub.id)).toEqual({ ok: true });
    expect(s.res.n).toBeCloseTo(0, 6);
    expect(startGrowth(s, nearest(s, 'laub').id)).toEqual({ ok: false, reason: 'busy' });
    simulate(s, q.length / CONFIG.growth.speed + 0.5, 0.1);
    expect(s.nodes[laub.id]!.connected).toBe(true);
    expect(s.growth).toBeNull();
    expect(connectedCount(s)).toBe(1);
  });
  it('Tippen beschleunigt einen wachsenden Faden', () => {
    const s = newGame(1);
    const laub = nearest(s, 'laub');
    s.res.n = 1e6;
    startGrowth(s, laub.id);
    tap(s);
    expect(s.growth!.progress).toBe(CONFIG.growth.tapBoost);
  });
  it('Ziele außerhalb der Reichweite sind nicht erreichbar', () => {
    const s = newGame(1);
    const far = s.nodes.filter((n) => n.dist > 600)[0]!;
    expect(findSource(s, far.id)).toBeNull();
    expect(startGrowth(s, far.id)).toEqual({ ok: false, reason: 'unreachable' });
  });
  it('Fäden können nicht durch Steine wachsen', () => {
    const s = newGame(1);
    const rock = s.nodes.find((n) => n.type === 'stein')!;
    // Ziel genau hinter dem Stein, Quelle davor
    s.nodes.push({ ...s.nodes[1]!, id: s.nodes.length, x: rock.x * 1.2, y: rock.y * 1.2, connected: false, type: 'laub', r: 9 });
    s.nodes.push({ ...s.nodes[1]!, id: s.nodes.length, x: rock.x * 0.8, y: rock.y * 0.8, connected: true, type: 'laub', r: 9 });
    const target = s.nodes[s.nodes.length - 2]!;
    const src = findSource(s, target.id);
    expect(src === null || src.id !== s.nodes.length - 1).toBe(true);
  });
  it('Kosten steigen mit jedem verbundenen Knoten', () => {
    const s = newGame(1);
    const id = nearest(s, 'totholz').id;
    const before = growthQuote(s, id)!.cost;
    connect(s, nearest(s, 'laub').id);
    expect(growthQuote(s, id)!.cost).toBeGreaterThan(before);
  });
});

describe('Produktion', () => {
  it('Laub produziert dauerhaft', () => {
    const s = newGame(1);
    connect(s, nearest(s, 'laub').id);
    simulate(s, 100, 0.1);
    expect(s.res.n).toBeGreaterThan(40);
  });
  it('Totholz erschöpft sich und liefert genau seinen Vorrat', () => {
    const s = newGame(1);
    const t = nearest(s, 'totholz');
    const stock = t.stock;
    connect(s, t.id);
    simulate(s, 10_000, 1);
    expect(s.nodes[t.id]!.stock).toBe(0);
    expect(s.res.n).toBeCloseTo(stock, 4);
  });
  it('Bäume brauchen Wasser für Zucker', () => {
    const s = newGame(1);
    connect(s, nearest(s, 'baum').id);
    simulate(s, 60);
    expect(s.res.sugar).toBe(0);
    connect(s, nearest(s, 'feucht').id);
    simulate(s, 60);
    expect(s.res.sugar).toBeGreaterThan(0);
    expect(computeRates(s).treeSupply).toBe(1);
  });
  it('Wasser ist gedeckelt', () => {
    const s = newGame(1);
    connect(s, nearest(s, 'feucht').id);
    simulate(s, 100_000, 10);
    expect(s.res.water).toBe(CONFIG.waterCap);
  });
});

describe('Upgrades', () => {
  it('Kosten wachsen geometrisch', () => {
    const s = newGame(1);
    const c0 = upgradeCost(s, 'hyphen').n;
    s.res.n = 1e9;
    buy(s, 'hyphen');
    expect(upgradeCost(s, "hyphen").n).toBeCloseTo(c0 * CONFIG.upgrades[0]!.growth, 9);
    expect(tap(s)).toBe(2);
  });
  it('Zucker-Upgrades erst nach dem ersten Baum', () => {
    const s = newGame(1);
    s.res = { n: 1e9, sugar: 1e9, water: 0, minerals: 0 };
    expect(buy(s, 'frucht')).toBe(false);
    connect(s, nearest(s, 'baum').id);
    expect(buy(s, 'frucht')).toBe(true);
    expect(computeRates(s).n).toBeGreaterThanOrEqual(CONFIG.effects.fruchtNps);
  });
  it('kein Kauf ohne genug Ressourcen', () => {
    const s = newGame(1);
    expect(buy(s, 'hyphen')).toBe(false);
    expect(s.levels.hyphen).toBe(0);
  });
});

describe('Spielstand', () => {
  const played = () => {
    const s = newGame(99);
    connect(s, nearest(s, 'totholz').id);
    connect(s, nearest(s, 'laub').id);
    s.res.n = 500;
    buy(s, 'hyphen');
    simulate(s, 30);
    return s;
  };
  it('Speichern und Laden ergibt denselben Zustand', () => {
    const s = played();
    const back = deserialize(JSON.parse(JSON.stringify(serialize(s, 1000))));
    expect(back).toEqual(s);
  });
  it('Text-Export funktioniert in beide Richtungen', () => {
    const s = played();
    const { state, savedAt } = importString(exportString(s, 1234));
    expect(state).toEqual(s);
    expect(savedAt).toBe(1234);
  });
  it('lehnt kaputte oder zu neue Spielstände ab', () => {
    expect(() => deserialize(null)).toThrow();
    expect(() => deserialize({ v: 999 })).toThrow();
    expect(() => importString('kein base64!')).toThrow();
  });
  it('Offline-Ertrag ist auf 12 Stunden gedeckelt', () => {
    const s = played();
    const r = applyOffline(s, 0, 48 * 3600 * 1000);
    expect(r.seconds).toBe(CONFIG.offlineCapSeconds);
    expect(r.gained).toBeGreaterThan(0);
  });
  it('negative Zeit (Uhr verstellt) gibt keinen Ertrag', () => {
    const s = played();
    expect(applyOffline(s, 10_000, 0).seconds).toBe(0);
  });
});

describe('Simulationsschritt', () => {
  it('Ergebnis hängt kaum von der Schrittgröße ab', () => {
    const a = newGame(4);
    const b = newGame(4);
    for (const s of [a, b]) {
      connect(s, nearest(s, 'laub').id);
      connect(s, nearest(s, 'totholz').id);
    }
    simulate(a, 120, 0.1);
    simulate(b, 120, 1);
    expect(Math.abs(a.res.n - b.res.n) / a.res.n).toBeLessThan(0.01);
  });
  it('tick erhöht die Spielzeit', () => {
    const s = newGame(1);
    tick(s, 0.1);
    expect(s.stats.playSeconds).toBeCloseTo(0.1, 9);
  });
});

describe('Zahlenformat', () => {
  it('kürzt deutsch', () => {
    expect(formatNumber(5.67)).toBe('5,6');
    expect(formatNumber(950.9)).toBe('950');
    expect(formatNumber(1234)).toBe('1,23 Tsd.');
    expect(formatNumber(4_500_000)).toBe('4,50 Mio.');
    expect(formatNumber(2e9)).toBe('2,00 Mrd.');
  });
  it('formatiert Dauern', () => {
    expect(formatDuration(45)).toBe('45 Sek.');
    expect(formatDuration(180)).toBe('3 Min.');
    expect(formatDuration(7500)).toBe('2 Std. 5 Min.');
  });
});

describe('Kurzformat Kopfzeile', () => {
  it('höchstens 3 gültige Ziffern', async () => {
    const { formatShort } = await import('../src/core/format');
    expect(formatShort(950)).toBe('950');
    expect(formatShort(5_413_000)).toBe('5,41 Mio.');
    expect(formatShort(54_130_000)).toBe('54,1 Mio.');
    expect(formatShort(541_530_000_000)).toBe('541 Mrd.');
  });
});
