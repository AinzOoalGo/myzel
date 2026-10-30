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
  /** 1 = Waldboden, 2 = Wald, 3 = Kontinent, 4 = Planet */
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
  if (zone === 4) return type === 'rivale' ? CONFIG.zone4.sizeScale * 0.9 : type === 'altbaum' || type === 'urwald' ? CONFIG.zone4.sizeScale * 0.6 : CONFIG.zone4.sizeScale;
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
  appendZone4(nodes, seed);
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

// ---------- Zone 4 „Planet“ ----------

/** Eine Landmasse: Mittelpunkt und welliger Rand (Radius schwankt mit dem Winkel). */
export interface Continent {
  x: number;
  y: number;
  r: number;
  /** Wellen des Randes: Stärke und Phase für 3er- und 5er-Welle */
  w3: number;
  p3: number;
  w5: number;
  p5: number;
}

const geoCache = new Map<number, Continent[]>();

/** Lage der Kontinente – eigener Zufall, unabhängig von den Knoten. */
export function planetGeography(seed: number): Continent[] {
  const hit = geoCache.get(seed);
  if (hit) return hit;
  const z = CONFIG.zone4;
  const rng = createRng((seed ^ 0x6e0a11) >>> 0);
  const rot = rng() * Math.PI * 2;
  const list: Continent[] = [];
  for (let i = 0; i < z.continents; i++) {
    const a = rot + (i / z.continents) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    let d = z.continentDist[0] + rng() * (z.continentDist[1] - z.continentDist[0]);
    const r = z.continentRadius[0] + rng() * (z.continentRadius[1] - z.continentRadius[0]);
    const w3 = 0.08 + rng() * 0.1;
    const p3 = rng() * Math.PI * 2;
    const w5 = 0.04 + rng() * 0.07;
    const p5 = rng() * Math.PI * 2;
    // immer ein Meeresarm zwischen Heimatkontinent und Landmasse (berühren sich nie)
    d = Math.max(d, z.coast + z.minStrait + r * (1 + w3 + w5));
    list.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r, w3, p3, w5, p5 });
  }
  if (geoCache.size > 20) geoCache.clear();
  geoCache.set(seed, list);
  return list;
}

/** Randradius eines Kontinents in Richtung des Winkels a. */
export function continentRadius(c: Continent, a: number): number {
  return c.r * (1 + c.w3 * Math.sin(3 * a + c.p3) + c.w5 * Math.sin(5 * a + c.p5));
}

/** Liegt der Punkt im Meer? Der Heimatkontinent (Zone 1–3) und die Landmassen sind Land. */
export function isOcean(geo: Continent[], x: number, y: number): boolean {
  if (Math.hypot(x, y) <= CONFIG.zone4.coast) return false;
  for (const c of geo) {
    const dx = x - c.x;
    const dy = y - c.y;
    if (Math.hypot(dx, dy) <= continentRadius(c, Math.atan2(dy, dx))) return false;
  }
  return true;
}

/** Führt die Strecke a→b über Wasser? (abgetastet; Strecken auf dem Heimatkontinent nie) */
export function segmentCrossesOcean(geo: Continent[], ax: number, ay: number, bx: number, by: number): boolean {
  const coast = CONFIG.zone4.coast;
  if (Math.hypot(ax, ay) <= coast && Math.hypot(bx, by) <= coast) return false;
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, Math.ceil(len / CONFIG.zone4.oceanSample));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (isOcean(geo, ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
  }
  return false;
}

/** Zone 4 – Landknoten auf den Kontinenten, Korallenriffe im Meer, ein Riesen-Schleimpilz. */
function appendZone4(nodes: MapNode[], seed: number): void {
  const z = CONFIG.zone4;
  const geo = planetGeography(seed);
  const rng = createRng((seed ^ 0x4a7e70) >>> 0);
  const tooClose = (x: number, y: number) =>
    nodes.some((n) => Math.hypot(n.x - x, n.y - y) < (n.zone === 4 ? z.minSpacing : n.zone === 3 ? CONFIG.zone3.minSpacing : 0));
  // Endgegner: Kern auf einem zufälligen Kontinent, etwas außerhalb der Mitte
  const home = geo[Math.floor(rng() * geo.length)]!;
  nodes.push(makeNode(nodes.length, home.x * 1.06, home.y * 1.06, 'rivale', 4));
  // Landknoten
  const total = Object.values(z.weights).reduce((a, b) => a + b, 0);
  let placed = 0;
  let attempts = 0;
  while (placed < z.landNodes && attempts < z.landNodes * 80) {
    attempts++;
    const c = geo[Math.floor(rng() * geo.length)]!;
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * continentRadius(c, a) * 0.94;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d;
    if (Math.hypot(x, y) < z.innerRadius || tooClose(x, y)) continue;
    let roll = rng() * total;
    let type: NodeType = 'laub';
    for (const [t, w] of Object.entries(z.weights) as [NodeType, number][]) {
      roll -= w;
      if (roll < 0) {
        type = t;
        break;
      }
    }
    nodes.push(makeNode(nodes.length, x, y, type, 4));
    placed++;
  }
  // Riff-Ketten: von der Heimatküste zu jedem Kontinent – so ist jede Landmasse sicher erreichbar
  for (const c of geo) {
    const a = Math.atan2(c.y, c.x);
    const from = z.coast + 300;
    // letztes Riff knapp vor der Küste, damit der Sprung an Land kurz bleibt
    const to = Math.hypot(c.x, c.y) - continentRadius(c, a + Math.PI) - 150;
    const steps = Math.max(1, Math.ceil((to - from) / z.reefChainStep));
    for (let i = 0; i <= steps; i++) {
      const d = from + ((to - from) * i) / steps;
      const side = (rng() - 0.5) * 2 * z.reefChainJitter;
      const x = Math.cos(a) * d - Math.sin(a) * side;
      const y = Math.sin(a) * d + Math.cos(a) * side;
      if (!isOcean(geo, x, y) || nodes.some((n) => n.zone === 4 && Math.hypot(n.x - x, n.y - y) < z.minSpacing * 0.6)) continue;
      nodes.push(makeNode(nodes.length, x, y, 'koralle', 4));
    }
  }
  // weitere Korallenriffe verstreut im Meer
  placed = 0;
  attempts = 0;
  while (placed < z.reefNodes && attempts < z.reefNodes * 200) {
    attempts++;
    const d = z.coast + 250 + Math.sqrt(rng()) * (z.outerRadius - z.coast - 250);
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (!isOcean(geo, x, y) || tooClose(x, y)) continue;
    nodes.push(makeNode(nodes.length, x, y, 'koralle', 4));
    placed++;
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
