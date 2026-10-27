import { CONFIG, type UpgradeDef, type UpgradeId } from './config';
import { generateMap, pointSegmentDistance, type MapNode } from './map';

export interface Edge {
  from: number;
  to: number;
}

export interface Growth {
  from: number;
  to: number;
  length: number;
  progress: number;
}

export interface Resources {
  n: number;
  sugar: number;
  water: number;
}

export interface GameState {
  seed: number;
  nodes: MapNode[];
  edges: Edge[];
  res: Resources;
  levels: Record<UpgradeId, number>;
  growth: Growth | null;
  stats: { totalN: number; taps: number; playSeconds: number; zoneDoneAt: number | null };
}

export interface Rates {
  n: number;
  sugar: number;
  waterIn: number;
  waterUse: number;
  /** Anteil der Baum-Nachfrage, der gedeckt ist (0..1). */
  treeSupply: number;
}

export function newGame(seed = Math.floor(Math.random() * 2 ** 31)): GameState {
  return {
    seed,
    nodes: generateMap(seed),
    edges: [],
    res: { n: 0, sugar: 0, water: 0 },
    levels: { hyphen: 0, enzym: 0, frucht: 0, rhizo: 0 },
    growth: null,
    stats: { totalN: 0, taps: 0, playSeconds: 0, zoneDoneAt: null },
  };
}

// ---------- abgeleitete Werte ----------

export const distanceBonus = (node: MapNode): number => 1 + node.dist / CONFIG.distanceScale;

export function connectedCount(s: GameState): number {
  // ohne die Spore selbst
  return s.nodes.reduce((c, n) => c + (n.connected && n.type !== 'spore' ? 1 : 0), 0);
}

export function tapValue(s: GameState): number {
  return CONFIG.tap.base + CONFIG.effects.hyphenTap * s.levels.hyphen;
}

export function decompMult(s: GameState): number {
  return 1 + CONFIG.effects.enzymDecomp * s.levels.enzym;
}

export function reach(s: GameState): number {
  return CONFIG.growth.reach + CONFIG.growth.reachPerRhizo * s.levels.rhizo;
}

export function growthSpeed(s: GameState): number {
  return CONFIG.growth.speed * (1 + CONFIG.effects.rhizoSpeed * s.levels.rhizo);
}

export function sugarUnlocked(s: GameState): boolean {
  return s.nodes.some((n) => n.connected && n.type === 'baum');
}

/** Nur Totholz: aktueller Abbau pro Sekunde (vor Erschöpfung). */
export function totholzRate(s: GameState, node: MapNode): number {
  return CONFIG.nodes.totholz.nps * distanceBonus(node) * decompMult(s);
}

/** Momentane Raten ohne Ressourcen zu verändern. `water` = aktueller Wasservorrat für die Baumversorgung. */
export function computeRates(s: GameState, dt = 1): Rates {
  let n = 0;
  let sugar = 0;
  let waterIn = 0;
  let treeDemand = 0;
  const dm = decompMult(s);
  for (const node of s.nodes) {
    if (!node.connected) continue;
    switch (node.type) {
      case 'laub':
        n += CONFIG.nodes.laub.nps * distanceBonus(node) * dm;
        break;
      case 'totholz':
        if (node.stock > 0) n += Math.min(totholzRate(s, node), node.stock / dt);
        break;
      case 'feucht':
        waterIn += CONFIG.nodes.feucht.water * distanceBonus(node);
        break;
      case 'baum':
        treeDemand += CONFIG.nodes.baum.waterUse;
        break;
      default:
        break;
    }
  }
  const available = s.res.water / dt + waterIn;
  const treeSupply = treeDemand === 0 ? 0 : Math.min(1, available / treeDemand);
  for (const node of s.nodes) {
    if (node.connected && node.type === 'baum') sugar += CONFIG.nodes.baum.sugar * distanceBonus(node) * treeSupply;
  }
  n += CONFIG.effects.fruchtNps * s.levels.frucht;
  return { n, sugar, waterIn, waterUse: treeDemand * treeSupply, treeSupply };
}

// ---------- Simulation ----------

export function tick(s: GameState, dt: number): void {
  const rates = computeRates(s, dt);
  // Totholz-Vorräte abbauen
  for (const node of s.nodes) {
    if (node.connected && node.type === 'totholz' && node.stock > 0) {
      node.stock = Math.max(0, node.stock - totholzRate(s, node) * dt);
    }
  }
  addNutrients(s, rates.n * dt);
  s.res.sugar += rates.sugar * dt;
  s.res.water = Math.min(CONFIG.waterCap, Math.max(0, s.res.water + (rates.waterIn - rates.waterUse) * dt));
  advanceGrowth(s, growthSpeed(s) * dt);
  s.stats.playSeconds += dt;
}

function addNutrients(s: GameState, amount: number): void {
  s.res.n += amount;
  s.stats.totalN += amount;
}

function advanceGrowth(s: GameState, units: number): void {
  const g = s.growth;
  if (!g) return;
  g.progress += units;
  if (g.progress >= g.length) {
    const target = s.nodes[g.to];
    if (target) target.connected = true;
    s.edges.push({ from: g.from, to: g.to });
    s.growth = null;
    if (s.stats.zoneDoneAt === null && connectedCount(s) >= CONFIG.zoneGoal) {
      s.stats.zoneDoneAt = s.stats.playSeconds;
    }
  }
}

/** Simuliert eine längere Zeitspanne in festen Schritten (z. B. Offline-Ertrag). */
export function simulate(s: GameState, seconds: number, step = 1): void {
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    tick(s, dt);
    left -= dt;
  }
}

// ---------- Aktionen des Spielers ----------

/** Tipp auf den Boden: bringt Nährstoffe und beschleunigt einen wachsenden Faden. Gibt den Ertrag zurück. */
export function tap(s: GameState): number {
  const v = tapValue(s);
  addNutrients(s, v);
  s.stats.taps++;
  advanceGrowth(s, CONFIG.growth.tapBoost * (1 + CONFIG.effects.rhizoSpeed * s.levels.rhizo));
  return v;
}

/** Ein Faden darf keinen Stein schneiden. */
export function pathClear(s: GameState, a: MapNode, b: MapNode): boolean {
  for (const node of s.nodes) {
    if (node.type !== 'stein' || node.id === b.id) continue;
    if (pointSegmentDistance(node.x, node.y, a.x, a.y, b.x, b.y) < node.r + CONFIG.growth.rockClearance) return false;
  }
  return true;
}

/** Nächster verbundener Knoten mit freiem Weg in Reichweite, sonst null. */
export function findSource(s: GameState, targetId: number): MapNode | null {
  const target = s.nodes[targetId];
  if (!target || target.connected || target.type === 'stein') return null;
  const maxReach = reach(s);
  let best: MapNode | null = null;
  let bestD = Infinity;
  for (const node of s.nodes) {
    if (!node.connected) continue;
    const d = Math.hypot(node.x - target.x, node.y - target.y);
    if (d <= maxReach && d < bestD && pathClear(s, node, target)) {
      best = node;
      bestD = d;
    }
  }
  return best;
}

export function growthCost(s: GameState, length: number): number {
  const g = CONFIG.growth;
  return g.costPerUnit * length * g.costPerNode ** connectedCount(s) * CONFIG.effects.rhizoCost ** s.levels.rhizo;
}

export type GrowResult = { ok: true } | { ok: false; reason: 'busy' | 'unreachable' | 'cost' };

export function growthQuote(s: GameState, targetId: number): { source: MapNode; length: number; cost: number } | null {
  const target = s.nodes[targetId];
  const source = findSource(s, targetId);
  if (!target || !source) return null;
  const length = Math.hypot(source.x - target.x, source.y - target.y);
  return { source, length, cost: growthCost(s, length) };
}

export function startGrowth(s: GameState, targetId: number): GrowResult {
  if (s.growth) return { ok: false, reason: 'busy' };
  const q = growthQuote(s, targetId);
  if (!q) return { ok: false, reason: 'unreachable' };
  if (s.res.n < q.cost) return { ok: false, reason: 'cost' };
  s.res.n -= q.cost;
  s.growth = { from: q.source.id, to: targetId, length: q.length, progress: 0 };
  return { ok: true };
}

export function upgradeDef(id: UpgradeId): UpgradeDef {
  const def = CONFIG.upgrades.find((u) => u.id === id);
  if (!def) throw new Error(`Unbekanntes Upgrade: ${id}`);
  return def;
}

export function upgradeCost(s: GameState, id: UpgradeId): { n: number; sugar: number } {
  const def = upgradeDef(id);
  const f = def.growth ** s.levels[id];
  return { n: def.baseCost.n * f, sugar: def.baseCost.sugar * f };
}

export function canBuy(s: GameState, id: UpgradeId): boolean {
  const def = upgradeDef(id);
  if (def.requiresSugar && !sugarUnlocked(s)) return false;
  const c = upgradeCost(s, id);
  return s.res.n >= c.n && s.res.sugar >= c.sugar;
}

export function buy(s: GameState, id: UpgradeId): boolean {
  if (!canBuy(s, id)) return false;
  const c = upgradeCost(s, id);
  s.res.n -= c.n;
  s.res.sugar -= c.sugar;
  s.levels[id]++;
  return true;
}
