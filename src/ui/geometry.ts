import { createRng } from '../core/rng';
import type { Edge } from '../core/game';

/**
 * Reine Geometrie für die Netz-Darstellung (ohne Canvas, daher testbar).
 * Ein Faden ist eine leicht geschwungene Polylinie, deterministisch aus den Knoten-IDs erzeugt,
 * damit er bei jedem Laden gleich aussieht.
 */

export interface Path {
  xs: number[];
  ys: number[];
  /** kumulierte Länge bis Punkt i */
  cum: number[];
  total: number;
}

export interface Hair {
  path: Path;
  /** Position entlang des Hauptfadens (0..1), ab der das Härchen sichtbar ist */
  at: number;
}

export interface Hypha {
  main: Path;
  hairs: Hair[];
}

const hash = (a: number, b: number): number => (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663)) >>> 0;

function finish(xs: number[], ys: number[]): Path {
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!));
  return { xs, ys, cum, total: cum[cum.length - 1]! };
}

/** Geschwungene Linie von (ax,ay) nach (bx,by); Ausschlag verschwindet an beiden Enden. */
export function wavyPath(ax: number, ay: number, bx: number, by: number, seed: number, amplitude = 0.07): Path {
  const rng = createRng(seed);
  const len = Math.hypot(bx - ax, by - ay);
  const nx = len ? -(by - ay) / len : 0;
  const ny = len ? (bx - ax) / len : 0;
  const amp1 = Math.min(12, len * amplitude) * (rng() * 2 - 1);
  const amp2 = Math.min(5, len * amplitude * 0.5) * (rng() * 2 - 1);
  const ph = rng() * Math.PI * 2;
  const steps = Math.max(6, Math.ceil(len / 5));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const env = Math.sin(Math.PI * t);
    const off = env * (amp1 * Math.sin(Math.PI * t) + amp2 * Math.sin(3 * Math.PI * t + ph));
    xs.push(ax + (bx - ax) * t + nx * off);
    ys.push(ay + (by - ay) * t + ny * off);
  }
  return finish(xs, ys);
}

/** Punkt bei Länge d entlang des Pfads. */
export function pointAt(p: Path, d: number): [number, number] {
  if (d <= 0) return [p.xs[0]!, p.ys[0]!];
  if (d >= p.total) return [p.xs[p.xs.length - 1]!, p.ys[p.ys.length - 1]!];
  let lo = 0;
  let hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const seg = p.cum[hi]! - p.cum[lo]!;
  const f = seg ? (d - p.cum[lo]!) / seg : 0;
  return [p.xs[lo]! + (p.xs[hi]! - p.xs[lo]!) * f, p.ys[lo]! + (p.ys[hi]! - p.ys[lo]!) * f];
}

/** Hauptfaden plus feine Seitenhärchen. */
export function buildHypha(from: { id: number; x: number; y: number }, to: { id: number; x: number; y: number }): Hypha {
  const seed = hash(from.id, to.id);
  const main = wavyPath(from.x, from.y, to.x, to.y, seed);
  const rng = createRng(seed ^ 0x9e3779b9);
  const count = Math.min(5, Math.floor(main.total / 30) + 1);
  const hairs: Hair[] = [];
  for (let i = 0; i < count; i++) {
    const at = 0.15 + rng() * 0.7;
    const d = at * main.total;
    const [x, y] = pointAt(main, d);
    const [x2, y2] = pointAt(main, d + 2);
    const dir = Math.atan2(y2 - y, x2 - x) + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6);
    const l = 8 + rng() * 16;
    hairs.push({ at, path: wavyPath(x, y, x + Math.cos(dir) * l, y + Math.sin(dir) * l, seed + i * 7919, 0.15) });
  }
  return { main, hairs };
}

/**
 * Wie viele Knoten hängen hinter jeder Kante (inkl. Zielknoten)?
 * Bestimmt die Fadendicke: Stränge nahe am Ursprung tragen mehr.
 */
export function subtreeWeights(edges: Edge[]): Map<number, number> {
  const children = new Map<number, number[]>();
  for (const e of edges) {
    const list = children.get(e.from) ?? [];
    list.push(e.to);
    children.set(e.from, list);
  }
  const memo = new Map<number, number>();
  const weight = (node: number): number => {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    let w = 1;
    // iterativ genug: das Netz ist ein Baum mit wenigen hundert Knoten
    for (const c of children.get(node) ?? []) w += weight(c);
    memo.set(node, w);
    return w;
  };
  const result = new Map<number, number>();
  for (const e of edges) result.set(e.to, weight(e.to));
  return result;
}
