import { CONFIG, type EventType, type GenomeDef, type GenomeId, type Season, type UpgradeDef, type UpgradeId } from './config';
import { generateMap, pointSegmentDistance, type MapNode } from './map';
import { createRng } from './rng';

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

/** Bleibt über den Sporenflug hinweg erhalten. */
export interface Meta {
  spores: number; // unverbraucht
  sporesTotal: number; // jemals gewonnen → Dauerbonus
  runs: number; // abgeschlossene Sporenflüge
  genome: GenomeId[];
  achievements: string[];
  lifetime: { totalN: number; taps: number; goldCaught: number; rainSeen: number; playSeconds: number; seasons: number; rivalsBeaten: number };
}

/** Konkurrenzpilz: besetzt nach und nach freie Knoten in Zone 2. */
export interface Rival {
  core: number; // Knoten-ID des Kerns
  edges: Edge[];
  nextAt: number; // Spielsekunden
  alive: boolean;
  /** wächst, wenn er in Reichweite nichts mehr findet */
  reach: number;
}

export interface ActiveEvent {
  type: Exclude<EventType, 'gold'>;
  until: number; // Spielsekunden
}

export interface Golden {
  x: number;
  y: number;
  until: number;
}

export interface EventsState {
  active: ActiveEvent | null;
  golden: Golden | null;
  nextAt: number;
  counter: number;
}

export interface GameState {
  seed: number;
  nodes: MapNode[];
  edges: Edge[];
  res: Resources;
  levels: Record<UpgradeId, number>;
  growth: Growth | null;
  /** Werte des aktuellen Durchlaufs */
  stats: { totalN: number; taps: number; playSeconds: number; zoneDoneAt: number | null; zone2DoneAt: number | null };
  meta: Meta;
  events: EventsState;
  zone: 1 | 2;
  /** Spielsekunde, ab der Zone 2 offen ist (für die Jahreszeiten) */
  zone2Since: number | null;
  rivals: Rival[];
}

export interface Rates {
  n: number;
  sugar: number;
  waterIn: number;
  waterUse: number;
  /** Anteil der Baum-Nachfrage, der gedeckt ist (0..1). */
  treeSupply: number;
}

export function newMeta(): Meta {
  return {
    spores: 0,
    sporesTotal: 0,
    runs: 0,
    genome: [],
    achievements: [],
    lifetime: { totalN: 0, taps: 0, goldCaught: 0, rainSeen: 0, playSeconds: 0, seasons: 0, rivalsBeaten: 0 },
  };
}

export function newGame(seed = Math.floor(Math.random() * 2 ** 31), meta: Meta = newMeta()): GameState {
  const s: GameState = {
    seed,
    nodes: generateMap(seed),
    edges: [],
    res: { n: 0, sugar: 0, water: 0 },
    levels: { hyphen: 0, enzym: 0, frucht: 0, rhizo: 0 },
    growth: null,
    stats: { totalN: 0, taps: 0, playSeconds: 0, zoneDoneAt: null, zone2DoneAt: null },
    meta,
    events: { active: null, golden: null, nextAt: CONFIG.events.firstAt, counter: 0 },
    zone: 1,
    zone2Since: null,
    rivals: [],
  };
  initRivals(s);
  if (has(s, 'p4')) s.res.n = CONFIG.genomeEffects.p4Start;
  return s;
}

// ---------- Modifikatoren ----------

export const has = (s: GameState, id: GenomeId): boolean => s.meta.genome.includes(id);

export function eventActive(s: GameState, type: ActiveEvent['type']): boolean {
  return s.events.active?.type === type && s.events.active.until > s.stats.playSeconds;
}

/** Alle Multiplikatoren an einer Stelle: Genom, Sporen, Erfolge, Ereignisse. */
const isTree = (n: MapNode): boolean => n.type === 'baum' || n.type === 'altbaum';

/** Aktuelle Jahreszeit – erst ab Zone 2. */
export function season(s: GameState): Season | null {
  if (s.zone < 2 || s.zone2Since === null) return null;
  const c = CONFIG.seasons;
  const i = Math.floor(Math.max(0, s.stats.playSeconds - s.zone2Since) / c.length) % c.order.length;
  return c.order[i] ?? null;
}

/** Sekunden bis zur nächsten Jahreszeit. */
export function seasonLeft(s: GameState): number {
  if (s.zone2Since === null) return 0;
  const len = CONFIG.seasons.length;
  return len - (Math.max(0, s.stats.playSeconds - s.zone2Since) % len);
}

/** Alle Multiplikatoren an einer Stelle: Genom, Sporen, Erfolge, Ereignisse, Zone, Jahreszeit. */
export function mods(s: GameState) {
  const g = CONFIG.genomeEffects;
  const sc = CONFIG.seasons;
  const se = season(s);
  const z2 = s.zone >= 2;
  const trees = has(s, 's4') ? s.nodes.reduce((c, n) => c + (n.connected && isTree(n) ? 1 : 0), 0) : 0;
  const global =
    (1 + CONFIG.prestige.sporeBonus * s.meta.sporesTotal) *
    (1 + CONFIG.achievementBonus * s.meta.achievements.length) *
    (1 + g.s4PerTree * trees) *
    (se === 'winter' ? sc.winter.global : 1);
  return {
    global,
    tap: has(s, 'z3') ? g.z3Tap : 1,
    decomp: (1 + CONFIG.effects.enzymDecomp * s.levels.enzym) * (has(s, 'z1') ? g.z1Decomp : 1),
    laub: (has(s, 'z4') ? g.z4Laub : 1) * (se === 'herbst' ? sc.herbst.laub : 1),
    stock: has(s, 'z2') ? g.z2Stock : 1,
    sugar: (has(s, 's1') ? g.s1Sugar : 1) * (se === 'sommer' ? sc.sommer.sugar : 1),
    water:
      (has(s, 's2') ? g.s2Water : 1) * (eventActive(s, 'regen') ? CONFIG.events.regen.water : 1) * (se === 'sommer' ? sc.sommer.water : 1),
    waterCap: CONFIG.waterCap * (has(s, 's2') ? g.s2Cap : 1),
    growthCost: CONFIG.effects.rhizoCost ** s.levels.rhizo * (has(s, 'p1') ? g.p1Cost : 1),
    growthSpeed:
      (1 + CONFIG.effects.rhizoSpeed * s.levels.rhizo) *
      (has(s, 'p3') ? g.p3Speed : 1) *
      (eventActive(s, 'regen') ? CONFIG.events.regen.growth : 1) *
      (z2 ? CONFIG.zone2.speedBonus : 1) *
      (se === 'fruehling' ? sc.fruehling.growth : se === 'winter' ? sc.winter.growth : 1),
    reach: CONFIG.growth.reach + CONFIG.growth.reachPerRhizo * s.levels.rhizo + (has(s, 'p2') ? g.p2Reach : 0) + (z2 ? CONFIG.zone2.reachBonus : 0),
    offlineCap: has(s, 's3') ? g.s3Offline : CONFIG.offlineCapSeconds,
  };
}

// ---------- abgeleitete Werte ----------

export const distanceBonus = (node: MapNode): number => 1 + node.dist / CONFIG.distanceScale;

export function connectedCount(s: GameState): number {
  return s.nodes.reduce((c, n) => c + (n.connected && n.type !== 'spore' ? 1 : 0), 0);
}

export function tapValue(s: GameState): number {
  const m = mods(s);
  return (CONFIG.tap.base + CONFIG.effects.hyphenTap * s.levels.hyphen) * m.tap * m.global;
}

export const reach = (s: GameState): number => mods(s).reach;
export const growthSpeed = (s: GameState): number => CONFIG.growth.speed * mods(s).growthSpeed;

export function sugarUnlocked(s: GameState): boolean {
  return s.nodes.some((n) => n.connected && isTree(n));
}

/** Totholz: Abbau des Vorrats pro Sekunde. */
export type Mods = ReturnType<typeof mods>;

export function totholzRate(s: GameState, node: MapNode, m: Mods = mods(s)): number {
  return CONFIG.nodes.totholz.nps * distanceBonus(node) * m.decomp;
}

/** Nährstoffertrag eines Knotens pro Sekunde (für Anzeige und Produktion). */
export function nodeYield(s: GameState, node: MapNode, m: Mods = mods(s)): number {
  if (node.type === 'laub') return CONFIG.nodes.laub.nps * distanceBonus(node) * m.decomp * m.laub * m.global;
  if (node.type === 'totholz') return node.stock > 0 ? totholzRate(s, node, m) * m.stock * m.global : 0;
  if (node.type === 'rivale') return CONFIG.rivals.coreNps * distanceBonus(node) * m.global;
  return 0;
}

export function computeRates(s: GameState, dt = 1, offline = false, m: Mods = mods(s)): Rates {
  let n = 0;
  let sugar = 0;
  let waterIn = 0;
  let treeDemand = 0;
  const drought = eventActive(s, 'duerre') ? (offline ? CONFIG.events.duerre.offlineWater : CONFIG.events.duerre.water) : 1;
  for (const node of s.nodes) {
    if (!node.connected) continue;
    switch (node.type) {
      case 'laub':
      case 'rivale':
        n += nodeYield(s, node, m);
        break;
      case 'totholz':
        if (node.stock > 0) n += Math.min(totholzRate(s, node, m), node.stock / dt) * m.stock * m.global;
        break;
      case 'feucht':
        waterIn += CONFIG.nodes.feucht.water * distanceBonus(node) * m.water * drought;
        break;
      case 'baum':
      case 'altbaum':
        treeDemand += CONFIG.nodes[node.type].waterUse;
        break;
      default:
        break;
    }
  }
  const available = s.res.water / dt + waterIn;
  const treeSupply = treeDemand === 0 ? 0 : Math.min(1, available / treeDemand);
  for (const node of s.nodes) {
    if (node.connected && isTree(node)) sugar += CONFIG.nodes[node.type as 'baum' | 'altbaum'].sugar * distanceBonus(node) * treeSupply * m.sugar;
  }
  n += CONFIG.effects.fruchtNps * s.levels.frucht * m.global;
  return { n, sugar, waterIn, waterUse: treeDemand * treeSupply, treeSupply };
}

// ---------- Simulation ----------

export function tick(s: GameState, dt: number, offline = false): void {
  const m = mods(s);
  const rates = computeRates(s, dt, offline, m);
  for (const node of s.nodes) {
    if (node.connected && node.type === 'totholz' && node.stock > 0) {
      node.stock = Math.max(0, node.stock - totholzRate(s, node, m) * dt);
    }
  }
  addNutrients(s, rates.n * dt);
  s.res.sugar += rates.sugar * dt;
  s.res.water = Math.min(m.waterCap, Math.max(0, s.res.water + (rates.waterIn - rates.waterUse) * dt));
  advanceGrowth(s, CONFIG.growth.speed * m.growthSpeed * dt);
  s.stats.playSeconds += dt;
  s.meta.lifetime.playSeconds += dt;
  updateEvents(s, offline);
  updateRivals(s, offline);
  const se = season(s);
  if (se) s.meta.lifetime.seasons |= 1 << CONFIG.seasons.order.indexOf(se);
}

function addNutrients(s: GameState, amount: number): void {
  s.res.n += amount;
  s.stats.totalN += amount;
  s.meta.lifetime.totalN += amount;
}

function advanceGrowth(s: GameState, units: number): void {
  const g = s.growth;
  if (!g) return;
  g.progress += units;
  if (g.progress >= g.length) {
    const target = s.nodes[g.to];
    s.growth = null;
    if (!target) return;
    if (target.type === 'rivale') defeatRival(s, target.owner - 1);
    else if (target.owner > 0) releaseNode(s, target);
    target.connected = true;
    s.edges.push({ from: g.from, to: g.to });
    const c = connectedCount(s);
    if (s.stats.zoneDoneAt === null && c >= CONFIG.zoneGoal) s.stats.zoneDoneAt = s.stats.playSeconds;
    if (s.zone < 2 && c >= CONFIG.zone2.unlockAt) {
      s.zone = 2;
      s.zone2Since = s.stats.playSeconds;
      for (const r of s.rivals) r.nextAt = s.stats.playSeconds + CONFIG.rivals.interval * 2;
    }
    if (s.stats.zone2DoneAt === null && c >= CONFIG.zone2.goal) s.stats.zone2DoneAt = s.stats.playSeconds;
  }
}

// ---------- Konkurrenzpilze ----------

function initRivals(s: GameState): void {
  s.rivals = [];
  for (const n of s.nodes) {
    if (n.type !== 'rivale') continue;
    n.owner = s.rivals.length + 1;
    s.rivals.push({ core: n.id, edges: [], nextAt: 0, alive: true, reach: CONFIG.rivals.reach });
  }
}

/**
 * Rivale verliert einen Knoten. Alles, was dahinter hing und nun nicht mehr mit seinem Kern
 * verbunden ist, wird ebenfalls frei – wer eine Leitung kappt, befreit den ganzen Ast.
 */
function releaseNode(s: GameState, node: MapNode): void {
  const index = node.owner - 1;
  const r = s.rivals[index];
  node.owner = 0;
  if (!r) return;
  r.edges = r.edges.filter((e) => e.from !== node.id && e.to !== node.id);
  const reached = new Set<number>([r.core]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of r.edges) {
      if (reached.has(e.from) && !reached.has(e.to)) {
        reached.add(e.to);
        grew = true;
      }
    }
  }
  r.edges = r.edges.filter((e) => reached.has(e.from) && reached.has(e.to));
  for (const n of s.nodes) if (n.owner === index + 1 && !reached.has(n.id)) n.owner = 0;
}

function defeatRival(s: GameState, index: number): void {
  const r = s.rivals[index];
  if (!r || !r.alive) return;
  r.alive = false;
  r.edges = [];
  for (const n of s.nodes) if (n.owner === index + 1) n.owner = 0;
  const reward = computeRates(s).n * CONFIG.rivals.defeatRewardSeconds;
  addNutrients(s, Math.max(reward, 100));
  s.meta.lifetime.rivalsBeaten++;
}

/** Ein Rivale besetzt den nächstgelegenen freien Knoten in Reichweite seines Netzes. */
export function rivalStep(s: GameState, index: number): MapNode | null {
  const r = s.rivals[index];
  if (!r || !r.alive) return null;
  const owned = s.nodes.filter((n) => n.owner === index + 1);
  let best: MapNode | null = null;
  let bestFrom: MapNode | null = null;
  let bestD = Infinity;
  for (const n of s.nodes) {
    if (n.zone !== 2 || n.connected || n.owner !== 0 || n.type === 'stein' || n.type === 'rivale') continue;
    if (s.growth?.to === n.id) continue;
    for (const o of owned) {
      const d = Math.hypot(o.x - n.x, o.y - n.y);
      if (d <= r.reach && d < bestD && pathClear(s, o, n)) {
        best = n;
        bestFrom = o;
        bestD = d;
      }
    }
  }
  if (!best || !bestFrom) return null;
  best.owner = index + 1;
  r.edges.push({ from: bestFrom.id, to: best.id });
  return best;
}

function updateRivals(s: GameState, offline: boolean): void {
  if (s.zone < 2) return;
  const now = s.stats.playSeconds;
  s.rivals.forEach((r, i) => {
    if (!r.alive || now < r.nextAt) return;
    r.nextAt = now + (offline ? CONFIG.rivals.offlineInterval : CONFIG.rivals.interval);
    if (!rivalStep(s, i) && r.reach < CONFIG.rivals.maxReach) {
      // nichts in Reichweite: weiter ausgreifen und bald erneut versuchen
      r.reach = Math.min(CONFIG.rivals.maxReach, r.reach + CONFIG.rivals.reachStep);
      r.nextAt = now + 15;
    }
  });
}

/** Simuliert eine längere Zeitspanne in festen Schritten (z. B. Offline-Ertrag). */
export function simulate(s: GameState, seconds: number, step = 1, offline = false): void {
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(step, left);
    tick(s, dt, offline);
    left -= dt;
  }
}

// ---------- Ereignisse ----------

function eventRng(s: GameState): () => number {
  return createRng((s.seed ^ Math.imul(s.events.counter + 1, 0x9e3779b1)) >>> 0);
}

function updateEvents(s: GameState, offline: boolean): void {
  const ev = s.events;
  const now = s.stats.playSeconds;
  if (ev.active && ev.active.until <= now) ev.active = null;
  if (ev.golden && ev.golden.until <= now) ev.golden = null;
  if (now < ev.nextAt || ev.active || ev.golden) return;
  const rng = eventRng(s);
  ev.counter++;
  const c = CONFIG.events;
  ev.nextAt = now + c.minGap + rng() * (c.maxGap - c.minGap);
  const hasTree = sugarUnlocked(s);
  const weights = { ...c.weights, duerre: hasTree ? c.weights.duerre : 0 };
  const total = weights.regen + weights.duerre + weights.gold;
  let roll = rng() * total;
  let type: EventType = 'regen';
  for (const t of ['regen', 'duerre', 'gold'] as EventType[]) {
    roll -= weights[t];
    if (roll < 0) {
      type = t;
      break;
    }
  }
  if (type === 'gold') {
    if (offline) return; // fangen kann man ihn nur, wenn man da ist
    const anchors = s.nodes.filter((n) => n.connected);
    const a = anchors[Math.floor(rng() * anchors.length)]!;
    const ang = rng() * Math.PI * 2;
    const d = 30 + rng() * reach(s) * 0.6;
    ev.golden = { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d, until: now + c.gold.duration };
    return;
  }
  ev.active = { type, until: now + c[type].duration };
  if (type === 'regen') s.meta.lifetime.rainSeen++;
}

/** Goldenen Fruchtkörper einsammeln: Bonus = 60 s Produktion. */
export function catchGolden(s: GameState): number {
  if (!s.events.golden) return 0;
  const reward = Math.max(CONFIG.events.gold.minReward * mods(s).global, computeRates(s).n * CONFIG.events.gold.rewardSeconds);
  addNutrients(s, reward);
  s.events.golden = null;
  s.meta.lifetime.goldCaught++;
  return reward;
}

// ---------- Aktionen ----------

export function tap(s: GameState): number {
  const v = tapValue(s);
  addNutrients(s, v);
  s.stats.taps++;
  s.meta.lifetime.taps++;
  advanceGrowth(s, CONFIG.growth.tapBoost * mods(s).growthSpeed);
  return v;
}

export function pathClear(s: GameState, a: MapNode, b: MapNode): boolean {
  for (const node of s.nodes) {
    if (node.type !== 'stein' || node.id === b.id) continue;
    if (pointSegmentDistance(node.x, node.y, a.x, a.y, b.x, b.y) < node.r + CONFIG.growth.rockClearance) return false;
  }
  return true;
}

export function findSource(s: GameState, targetId: number): MapNode | null {
  const target = s.nodes[targetId];
  if (!target || target.connected || target.type === 'stein' || target.zone > s.zone) return null;
  if (target.type === 'rivale' && !s.rivals[target.owner - 1]?.alive) return null;
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

/** Kosten eines Fadens; besetzte Knoten und Rivalen-Kerne kosten ein Vielfaches. */
export function growthCost(s: GameState, length: number, target?: MapNode): number {
  const g = CONFIG.growth;
  const n = connectedCount(s);
  const u = CONFIG.zone2.unlockAt;
  const scale = n <= u ? g.costPerNode ** n : g.costPerNode ** u * CONFIG.zone2.costPerNode ** (n - u);
  const extra = !target ? 1 : target.type === 'rivale' ? CONFIG.rivals.coreCost : target.owner > 0 ? CONFIG.rivals.reclaimCost : 1;
  return g.costPerUnit * length * scale * mods(s).growthCost * extra;
}

export type GrowResult = { ok: true } | { ok: false; reason: 'busy' | 'unreachable' | 'cost' };

export function growthQuote(s: GameState, targetId: number): { source: MapNode; length: number; cost: number } | null {
  const target = s.nodes[targetId];
  const source = findSource(s, targetId);
  if (!target || !source) return null;
  const length = Math.hypot(source.x - target.x, source.y - target.y);
  return { source, length, cost: growthCost(s, length, target) };
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

// ---------- Sporenflug & Genom ----------

export function sporeGain(s: GameState): number {
  return Math.floor(Math.sqrt(s.stats.totalN / CONFIG.prestige.divisor));
}

export function canPrestige(s: GameState): boolean {
  return connectedCount(s) >= CONFIG.prestige.minNodes && sporeGain(s) >= 1;
}

/** Neuer Wald, gleiche Meta-Daten plus die gewonnenen Sporen. */
export function prestige(s: GameState, newSeed = Math.floor(Math.random() * 2 ** 31)): GameState | null {
  if (!canPrestige(s)) return null;
  const gain = sporeGain(s);
  const meta: Meta = {
    ...s.meta,
    spores: s.meta.spores + gain,
    sporesTotal: s.meta.sporesTotal + gain,
    runs: s.meta.runs + 1,
    genome: [...s.meta.genome],
    achievements: [...s.meta.achievements],
    lifetime: { ...s.meta.lifetime },
  };
  return newGame(newSeed, meta);
}

export function genomeDef(id: GenomeId): GenomeDef {
  const d = CONFIG.genome.find((g) => g.id === id);
  if (!d) throw new Error(`Unbekannte Mutation: ${id}`);
  return d;
}

export function genomeAvailable(s: GameState, id: GenomeId): boolean {
  if (has(s, id)) return false;
  const d = genomeDef(id);
  if (d.tier === 1) return true;
  const prev = CONFIG.genome.find((g) => g.branch === d.branch && g.tier === d.tier - 1);
  return !!prev && has(s, prev.id);
}

export function buyGenome(s: GameState, id: GenomeId): boolean {
  if (!genomeAvailable(s, id)) return false;
  const d = genomeDef(id);
  if (s.meta.spores < d.cost) return false;
  s.meta.spores -= d.cost;
  s.meta.genome.push(id);
  return true;
}
