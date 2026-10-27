import { describe, expect, it } from 'bun:test';
import { buildHypha, pointAt, subtreeWeights, wavyPath } from '../src/ui/geometry';

describe('Faden-Geometrie', () => {
  it('beginnt und endet exakt an den Knoten', () => {
    const p = wavyPath(10, 20, 110, -40, 5);
    expect(p.xs[0]).toBe(10);
    expect(p.ys[0]).toBe(20);
    expect(p.xs[p.xs.length - 1]).toBeCloseTo(110, 9);
    expect(p.ys[p.ys.length - 1]).toBeCloseTo(-40, 9);
  });
  it('ist etwas länger als die Luftlinie, aber nicht viel', () => {
    const p = wavyPath(0, 0, 100, 0, 3);
    expect(p.total).toBeGreaterThanOrEqual(100);
    expect(p.total).toBeLessThan(110);
  });
  it('ist deterministisch', () => {
    expect(buildHypha({ id: 1, x: 0, y: 0 }, { id: 2, x: 80, y: 30 })).toEqual(buildHypha({ id: 1, x: 0, y: 0 }, { id: 2, x: 80, y: 30 }));
  });
  it('pointAt liefert Anfang, Ende und Zwischenpunkte', () => {
    const p = wavyPath(0, 0, 100, 0, 1, 0);
    expect(pointAt(p, -5)).toEqual([0, 0]);
    expect(pointAt(p, 1e9)[0]).toBeCloseTo(100, 9);
    expect(pointAt(p, 50)[0]).toBeCloseTo(50, 6);
  });
  it('hat Seitenhärchen', () => {
    expect(buildHypha({ id: 0, x: 0, y: 0 }, { id: 9, x: 120, y: 0 }).hairs.length).toBeGreaterThan(0);
  });
});

describe('Fadendicke nach Fluss', () => {
  it('zählt alle Knoten hinter einer Kante', () => {
    // 0 → 1 → 2, 1 → 3, 0 → 4
    const w = subtreeWeights([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 0, to: 4 },
    ]);
    expect(w.get(1)).toBe(3);
    expect(w.get(2)).toBe(1);
    expect(w.get(4)).toBe(1);
  });
});
