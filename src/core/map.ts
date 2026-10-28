import { CONFIG, type Climate, type NodeType, type Zone } from './config';
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
  /** 1 = Waldboden, 2 = Wald, 3 = Kontinent */
  zone: Zone;
  /** nur Zone 3: Klimazone */
  climate: Climate | null;
  /** 0 = frei, k = von Rivale k-1 besetzt */
  owner: number;
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

function sizeScale(zone: Zone, type: NodeType): number {
  if (zone === 2) return type !== 'altbaum' && type !== 'rivale' ? CONFIG.zone2.sizeScale : 1;
  if (zone === 3) return type === 'altbaum' || type === 'rivale' ? CONFIG.zone3.sizeScale * 0.55 : CONFIG.zone3.sizeScale;
  return 1;
}

function makeNode(id: number, x: number, y: number, type: NodeType, zone: Zone = 1, climate: Climate | null = null): MapNode {
  const dist = Math.hypot(x, y);
  return {
    id,
    x,
    y,
    type,
    r: CONFIG.map.radius_by_type[type] * sizeScale(zone, type),
    dist,
    stock: type === 'totholz' ? totholzStock(dist) : 0,
    connected: type === 'spore',
    zone,
    climate,
    owner: 0,
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
  appendZone2(nodes, seed);
  appendZone3(nodes, seed);
  return nodes;
}

const CLIMATES: Climate[] = ['tropen', 'steppe', 'taiga'];

/** Klimazone eines Punkts: drei gleich große Himmelsrichtungen, je Karte gedreht. */
export function climateAt(x: number, y: number, rotation: number): Climate {
  const a = (((Math.atan2(y, x) - rotation) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return CLIMATES[Math.min(2, Math.floor(a / ((Math.PI * 2) / 3)))]!;
}

export function climateRotation(seed: number): number {
  return createRng((seed ^ 0xc11a7e) >>> 0)() * Math.PI * 2;
}

/** Zone 3 – eigener Zufallsgenerator, damit Zone 1 und 2 unverändert bleiben. */
function appendZone3(nodes: MapNode[], seed: number): void {
  const z = CONFIG.zone3;
  const rng = createRng((seed ^ 0x3c0717) >>> 0);
  const rot = climateRotation(seed);
  const rivalRot = rng() * Math.PI * 2;
  for (let i = 0; i < z.rivals; i++) {
    const a = rivalRot + (i / z.rivals) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const d = z.rivalMinDist + rng() * (z.outerRadius - 300 - z.rivalMinDist);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    nodes.push(makeNode(nodes.length, x, y, 'rivale', 3, climateAt(x, y, rot)));
  }
  const target = nodes.length + z.nodeCount;
  const total = Object.values(z.weights).reduce((a, b) => a + b, 0);
  let attempts = 0;
  while (nodes.length < target && attempts < z.nodeCount * 60) {
    attempts++;
    const d = Math.sqrt(z.innerRadius ** 2 + rng() * (z.outerRadius ** 2 - z.innerRadius ** 2));
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < (n.zone === 3 ? z.minSpacing : CONFIG.zone2.minSpacing))) continue;
    let roll = rng() * total;
    let type: NodeType = 'laub';
    for (const [t, w] of Object.entries(z.weights) as [NodeType, number][]) {
      roll -= w;
      if (roll < 0) {
        type = t;
        break;
      }
    }
    nodes.push(makeNode(nodes.length, x, y, type, 3, climateAt(x, y, rot)));
  }
}

/**
 * Zone 2 wird mit eigenem Zufallsgenerator angehängt. Dadurch bleiben alle Zone-1-Knoten
 * (und damit alte Spielstände, die nur Knoten-IDs speichern) exakt gleich.
 */
function appendZone2(nodes: MapNode[], seed: number): void {
  const z = CONFIG.zone2;
  const rng = createRng((seed ^ 0x5a2e2) >>> 0);
  // Konkurrenzpilze gleichmäßig verteilt, weit draußen
  const rot = rng() * Math.PI * 2;
  for (let i = 0; i < z.rivals; i++) {
    const a = rot + (i / z.rivals) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const d = z.rivalMinDist + rng() * (z.outerRadius - 150 - z.rivalMinDist);
    nodes.push(makeNode(nodes.length, Math.cos(a) * d, Math.sin(a) * d, 'rivale', 2));
  }
  const target = nodes.length + z.nodeCount;
  const total = Object.values(z.weights).reduce((a, b) => a + b, 0);
  let attempts = 0;
  while (nodes.length < target && attempts < z.nodeCount * 60) {
    attempts++;
    const d = Math.sqrt(z.innerRadius ** 2 + rng() * (z.outerRadius ** 2 - z.innerRadius ** 2));
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < (n.zone === 2 ? z.minSpacing : CONFIG.map.minSpacing))) continue;
    let roll = rng() * total;
    let type: NodeType = 'laub';
    for (const [t, w] of Object.entries(z.weights) as [NodeType, number][]) {
      roll -= w;
      if (roll < 0) {
        type = t;
        break;
      }
    }
    nodes.push(makeNode(nodes.length, x, y, type, 2));
  }
}

/** Abstand eines Punkts zu einer Strecke. */
export function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
