import { CONFIG, type NodeType } from './config';
import { createRng } from './rng';

export interface MapNode {
  id: number;
  x: number;
  y: number;
  type: NodeType;
  r: number;
  /** Entfernung zum Startpunkt – bestimmt den Ertragsbonus. */
  dist: number;
  /** Nur Totholz: verbleibender Vorrat. */
  stock: number;
  connected: boolean;
}

const START_CLUSTER: { type: NodeType; dist: number; angle: number }[] = [
  { type: 'laub', dist: 60, angle: 0.3 },
  { type: 'laub', dist: 70, angle: 2.4 },
  { type: 'laub', dist: 78, angle: 4.3 },
  { type: 'totholz', dist: 115, angle: 1.3 },
  { type: 'feucht', dist: 140, angle: 3.4 },
  { type: 'baum', dist: 175, angle: 2.9 },
];

export function totholzStock(dist: number): number {
  const c = CONFIG.nodes.totholz;
  return c.stockBase + c.stockPerDistance * dist;
}

function makeNode(id: number, x: number, y: number, type: NodeType): MapNode {
  const dist = Math.hypot(x, y);
  return {
    id,
    x,
    y,
    type,
    r: CONFIG.map.radius_by_type[type],
    dist,
    stock: type === 'totholz' ? totholzStock(dist) : 0,
    connected: type === 'spore',
  };
}

function pickType(rng: () => number, dist: number): NodeType {
  const w = { ...CONFIG.map.weights };
  if (dist < CONFIG.map.rockFreeRadius) w.stein = 0;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const [type, weight] of Object.entries(w) as [NodeType, number][]) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return 'laub';
}

/** Erzeugt die Karte deterministisch aus dem Seed. Knoten 0 ist immer die Spore im Zentrum. */
export function generateMap(seed: number): MapNode[] {
  const rng = createRng(seed);
  const nodes: MapNode[] = [makeNode(0, 0, 0, 'spore')];
  const rot = rng() * Math.PI * 2;
  for (const s of START_CLUSTER) {
    const a = s.angle + rot;
    nodes.push(makeNode(nodes.length, Math.cos(a) * s.dist, Math.sin(a) * s.dist, s.type));
  }
  const { radius, nodeCount, minSpacing } = CONFIG.map;
  let attempts = 0;
  while (nodes.length < nodeCount && attempts < nodeCount * 60) {
    attempts++;
    // sqrt für gleichmäßige Flächenverteilung
    const d = Math.sqrt(rng()) * radius;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < minSpacing)) continue;
    nodes.push(makeNode(nodes.length, x, y, pickType(rng, d)));
  }
  return nodes;
}

/** Abstand eines Punkts zu einer Strecke. */
export function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
