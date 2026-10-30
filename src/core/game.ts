import { CONFIG, type Cost, type EventType, type GenomeDef, type GenomeId, type Season, type UpgradeDef, type UpgradeId, type Zone } from './config';
import { generateMap, planetGeography, pointSegmentDistance, segmentCrossesOcean, type MapNode } from './map';
import { createRng } from './rng';
import { bump, newDaily, type Daily } from './daily';
import { newRunTrack, newTrack, type RunRecord, type Track } from './tracking';

export interface Edge {
  from: number;
  to: number;
}

export interface Growth {
  from: number;
  to: number;
  length: number;
  progress: number;
  /** Tiefsee-Faden (über Wasser): wächst langsamer */
  ocean?: boolean;
}

export interface Resources {
  n: number;
  sugar: number;
  water: number;
  /** ab Zone 3: aus Mineraladern */
  minerals: number;
}

/** Bleibt über den Sporenflug hinweg erhalten. */
export interface Meta {
  spores: number; // unverbraucht
  sporesTotal: number; // jemals gewonnen → Dauerbonus
  runs: number; // abgeschlossene Sporenflüge
  genome: GenomeId[];
  /** Stufen der Mutationen (fehlt ein Eintrag, ist eine gekaufte Mutation Stufe 1) */
  genomeLevels: Partial<Record<GenomeId, number>>;
  /** tägliche Aufgaben (bleiben über den Sporenflug erhalten) */
  daily: Daily;
  /** Spielstatistik (nur lokal) */
  track: Track;
  /** wie viele Abspänne (Planet umspannt) der Spieler schon gesehen hat – auch wenn es offline passierte */
  finaleSeen: number;
  achievements: string[];
  lifetime: {
    totalN: number;
    taps: number;
    goldCaught: number;
    rainSeen: number;
    playSeconds: number;
    seasons: number;
    rivalsBeaten: number;
    minerals: number;
    windSeen: number;
    /** Riesen-Schleimpilz besiegt (Anzahl) */
    bossBeaten: number;
    /** Planet umspannt (Anzahl Finale) */
    planets: number;
    /** höchste je erreichte Zone (schaltet den Ast „Weltenpilz“ frei) */
    maxZone: number;
  };
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
  stats: {
    totalN: number;
    taps: number;
    playSeconds: number;
    zoneDoneAt: number | null;
    zone2DoneAt: number | null;
    zone3DoneAt: number | null;
    /** Planet umspannt (150 Knoten + Schleimpilz besiegt) */
    zone4DoneAt: number | null;
  };
  meta: Meta;
  events: EventsState;
  zone: Zone;
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
  minerals: number;
}

export function newMeta(): Meta {
  return {
    spores: 0,
    sporesTotal: 0,
    runs: 0,
    genome: [],
    genomeLevels: {},
    daily: newDaily(),
    track: newTrack(),
    finaleSeen: 0,
    achievements: [],
    lifetime: { totalN: 0, taps: 0, goldCaught: 0, rainSeen: 0, playSeconds: 0, seasons: 0, rivalsBeaten: 0, minerals: 0, windSeen: 0, bossBeaten: 0, planets: 0, maxZone: 1 },
  };
}

export function newGame(seed = Math.floor(Math.random() * 2 ** 31), meta: Meta = newMeta()): GameState {
  const s: GameState = {
    seed,
    nodes: generateMap(seed),
    edges: [],
    res: { n: 0, sugar: 0, water: 0, minerals: 0 },
    levels: { hyphen: 0, enzym: 0, frucht: 0, rhizo: 0, kristall: 0, fern: 0, tiefsee: 0, planet: 0 },
    growth: null,
    stats: { totalN: 0, taps: 0, playSeconds: 0, zoneDoneAt: null, zone2DoneAt: null, zone3DoneAt: null, zone4DoneAt: null },
    meta,
    events: { active: null, golden: null, nextAt: CONFIG.events.firstAt, counter: 0 },
    zone: 1,
    zone2Since: null,
    rivals: [],
  };
  initRivals(s);
  if (has(s, 'p4')) s.res.n = CONFIG.genomeEffects.p4Start * 10 ** (lv(s, 'p4') - 1);
  return s;
}

// ---------- Modifikatoren ----------

export const has = (s: GameState, id: GenomeId): boolean => s.meta.genome.includes(id);

/** Stufe einer Mutation: 0 = nicht gekauft. */
export const lv = (s: GameState, id: GenomeId): number => (has(s, id) ? Math.max(1, s.meta.genomeLevels[id] ?? 1) : 0);

/** Multiplikator mit Stufe-1-Wert v: 1 + (v − 1) × Stufe; Stufe 0 → 1. */
const mul = (s: GameState, id: GenomeId, v: number): number => 1 + (v - 1) * lv(s, id);

export function eventActive(s: GameState, type: ActiveEvent['type']): boolean {
  return s.events.active?.type === type && s.events.active.until > s.stats.playSeconds;
}

/** Alle Multiplikatoren an einer Stelle: Genom, Sporen, Erfolge, Ereignisse. */
export const isTree = (n: MapNode): boolean => n.type === 'baum' || n.type === 'altbaum' || n.type === 'urwald';

/** Klima-Faktoren eines Knotens (nur Zone 3, sonst neutral). */
export function climateOf(node: MapNode): { yield: number; growth: number; water: number; totholz: number; noDrought: boolean } {
  const c = node.climate ? CONFIG.zone3.climate[node.climate] : null;
  return {
    yield: c?.yield ?? 1,
    growth: c?.growth ?? 1,
    water: c?.water ?? 1,
    totholz: c && 'totholz' in c ? c.totholz : 1,
    noDrought: !!c && 'noDrought' in c && c.noDrought,
  };
}

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
  const z3 = s.zone >= 3;
  const z4 = s.zone >= 4;
  const trees = has(s, 's4') ? s.nodes.reduce((c, n) => c + (n.connected && isTree(n) ? 1 : 0), 0) * lv(s, 's4') : 0;
  const count = connectedCount(s);
  const nodes = count * lv(s, 'w4');
  const global =
    (1 + CONFIG.prestige.sporeBonus * s.meta.sporesTotal) *
    (1 + CONFIG.achievementBonus * s.meta.achievements.length) *
    (1 + g.s4PerTree * trees) *
    (1 + CONFIG.effects.kristallGlobal) ** s.levels.kristall *
    (1 + g.w4PerNode * nodes) *
    (1 + CONFIG.effects.planetGlobal) ** s.levels.planet *
    (se === 'winter' ? sc.winter.global : 1);
  return {
    /** verbundene Knoten (einmal gezählt, für Kostenberechnungen) */
    count,
    global,
    tap: mul(s, 'z3', g.z3Tap),
    decomp: (1 + CONFIG.effects.enzymDecomp * s.levels.enzym) * mul(s, 'z1', g.z1Decomp),
    laub: mul(s, 'z4', g.z4Laub) * (se === 'herbst' ? sc.herbst.laub : 1),
    stock: mul(s, 'z2', g.z2Stock),
    sugar: mul(s, 's1', g.s1Sugar) * (se === 'sommer' ? sc.sommer.sugar : 1),
    water:
      mul(s, 's2', g.s2Water) * (eventActive(s, 'regen') ? CONFIG.events.regen.water : 1) * (se === 'sommer' ? sc.sommer.water : 1),
    waterCap: CONFIG.waterCap * mul(s, 's2', g.s2Cap),
    growthCost: CONFIG.effects.rhizoCost ** s.levels.rhizo * 1 / (1 + (1 / g.p1Cost - 1) * lv(s, 'p1')), // Stufe 1: ×0,8 · Stufe 5: ×0,44 (abnehmender Effekt)
    growthSpeed:
      (1 + CONFIG.effects.rhizoSpeed * s.levels.rhizo) *
      mul(s, 'p3', g.p3Speed) *
      (eventActive(s, 'regen') ? CONFIG.events.regen.growth : 1) *
      (z2 ? CONFIG.zone2.speedBonus : 1) *
      (z3 ? CONFIG.zone3.speedBonus : 1) *
      (z4 ? CONFIG.zone4.speedBonus : 1) *
      (se === 'fruehling' ? sc.fruehling.growth : se === 'winter' ? sc.winter.growth : 1),
    reach:
      CONFIG.growth.reach +
      CONFIG.growth.reachPerRhizo * s.levels.rhizo +
      g.p2Reach * lv(s, 'p2') +
      (z2 ? CONFIG.zone2.reachBonus : 0) +
      (z3 ? CONFIG.zone3.reachBonus + CONFIG.effects.fernReach * s.levels.fern : 0) +
      (z4 ? CONFIG.zone4.reachBonus : 0),
    // jede Stufe „Langer Schlaf“ verlängert die Offline-Grenze um weitere 12 Stunden
    offlineCap: CONFIG.offlineCapSeconds + (g.s3Offline - CONFIG.offlineCapSeconds) * lv(s, 's3'),
    minerals: mul(s, 'w2', g.w2Min),
    hex: mul(s, 'w3', g.w3Hex),
    /** Tiefsee-Fäden: Kostenfaktor (ohne Upgrade gar nicht möglich) */
    ocean:
      CONFIG.zone4.oceanCost *
      CONFIG.zone4.oceanCostPerLevel ** Math.max(0, s.levels.tiefsee - 1) *
      (1 / (1 + (1 / g.o1Ocean - 1) * lv(s, 'o1'))),
    vulkan: mul(s, 'o2', g.o2Vulkan),
    /** Urwald-Riesen und Korallenriffe */
    planetNodes: mul(s, 'o3', g.o3Planet),
    /** Wartezeit des Schleimpilzes zwischen zwei Schritten */
    bossSlow: 1 + g.o4Boss * lv(s, 'o4'),
  };
}

// ---------- abgeleitete Werte ----------

export const distanceBonus = (node: MapNode): number => {
  const edge = CONFIG.zone2.outerRadius;
  return 1 + Math.min(node.dist, edge) / CONFIG.distanceScale + Math.max(0, node.dist - edge) / CONFIG.zone3.distanceScaleOuter;
};

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

export function mineralsUnlocked(s: GameState): boolean {
  return s.res.minerals > 0 || s.nodes.some((n) => n.connected && n.type === 'mineral');
}

/** Totholz: Abbau des Vorrats pro Sekunde. */
export type Mods = ReturnType<typeof mods>;

export function totholzRate(s: GameState, node: MapNode, m: Mods = mods(s)): number {
  const c = climateOf(node);
  return CONFIG.nodes.totholz.nps * distanceBonus(node) * m.decomp * c.yield * c.totholz;
}

/** Nährstoffertrag eines Knotens pro Sekunde (für Anzeige und Produktion). */
export function nodeYield(s: GameState, node: MapNode, m: Mods = mods(s)): number {
  const c = climateOf(node).yield;
  if (node.type === 'laub') return CONFIG.nodes.laub.nps * distanceBonus(node) * m.decomp * m.laub * m.global * c;
  if (node.type === 'totholz') return node.stock > 0 ? totholzRate(s, node, m) * m.stock * m.global : 0;
  if (node.type === 'rivale') return CONFIG.rivals.coreNps * distanceBonus(node) * m.global * c;
  if (node.type === 'moor') return CONFIG.zone3Nodes.moor.nps * distanceBonus(node) * m.decomp * m.global * c;
  if (node.type === 'koralle') return CONFIG.zone4Nodes.koralle.nps * distanceBonus(node) * m.planetNodes * m.global;
  return 0;
}

/** Wasser eines Knotens pro Sekunde (Feuchtstelle, Moor). */
export function nodeWater(node: MapNode, m: Mods, droughtFactor = 1): number {
  const c = climateOf(node);
  const base =
    node.type === 'feucht'
      ? CONFIG.nodes.feucht.water
      : node.type === 'moor'
        ? CONFIG.zone3Nodes.moor.water
        : node.type === 'koralle'
          ? CONFIG.zone4Nodes.koralle.water
          : 0;
  return base * distanceBonus(node) * m.water * c.water * (c.noDrought ? 1 : droughtFactor);
}

/** Mineralien einer Ader pro Sekunde (ohne Entfernungsbonus – sie sollen knapp bleiben). Vulkane: nur gekühlt (supply = Wasseranteil). */
export function nodeMinerals(node: MapNode, m: Mods, supply = 1): number {
  if (node.type === 'mineral') return CONFIG.zone3Nodes.mineral.min * m.minerals * climateOf(node).yield;
  if (node.type === 'vulkan') return CONFIG.zone4Nodes.vulkan.min * m.minerals * m.vulkan * supply;
  return 0;
}

/** Wasserbedarf eines Knotens (Bäume trinken, Vulkane brauchen Kühlung). */
export function waterUseOf(node: MapNode): number {
  if (node.type === 'baum' || node.type === 'altbaum' || node.type === 'urwald') return CONFIG.nodes[node.type].waterUse;
  if (node.type === 'vulkan') return CONFIG.zone4Nodes.vulkan.waterUse;
  return 0;
}

/** Zucker eines Baums pro Sekunde bei vollem Wasser. */
export function treeSugar(node: MapNode, m: Mods): number {
  if (!isTree(node)) return 0;
  const t = node.type as 'baum' | 'altbaum' | 'urwald';
  return CONFIG.nodes[t].sugar * distanceBonus(node) * m.sugar * climateOf(node).yield * (t === 'urwald' ? m.planetNodes : 1);
}

export function computeRates(s: GameState, dt = 1, offline = false, m: Mods = mods(s)): Rates {
  let n = 0;
  let sugar = 0;
  let waterIn = 0;
  let treeDemand = 0;
  let minerals = 0;
  const drought = eventActive(s, 'duerre') ? (offline ? CONFIG.events.duerre.offlineWater : CONFIG.events.duerre.water) : 1;
  for (const node of s.nodes) {
    if (!node.connected) continue;
    switch (node.type) {
      case 'laub':
      case 'rivale':
        n += nodeYield(s, node, m);
        break;
      case 'koralle':
        n += nodeYield(s, node, m);
        waterIn += nodeWater(node, m, drought);
        break;
      case 'moor':
        n += nodeYield(s, node, m);
        waterIn += nodeWater(node, m, drought);
        break;
      case 'mineral':
        minerals += nodeMinerals(node, m);
        break;
      case 'totholz':
        if (node.stock > 0) n += Math.min(totholzRate(s, node, m), node.stock / dt) * m.stock * m.global;
        break;
      case 'feucht':
        waterIn += nodeWater(node, m, drought);
        break;
      case 'baum':
      case 'altbaum':
      case 'urwald':
      case 'vulkan':
        treeDemand += waterUseOf(node);
        break;
      default:
        break;
    }
  }
  const available = s.res.water / dt + waterIn;
  const treeSupply = treeDemand === 0 ? 0 : Math.min(1, available / treeDemand);
  for (const node of s.nodes) {
    if (!node.connected) continue;
    if (isTree(node)) sugar += treeSugar(node, m) * treeSupply;
    else if (node.type === 'vulkan') minerals += nodeMinerals(node, m, treeSupply);
  }
  n += CONFIG.effects.fruchtNps * s.levels.frucht * m.global;
  return { n, sugar, waterIn, waterUse: treeDemand * treeSupply, treeSupply, minerals };
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
  s.res.minerals += rates.minerals * dt;
  s.meta.lifetime.minerals += rates.minerals * dt;
  s.res.water = Math.min(m.waterCap, Math.max(0, s.res.water + (rates.waterIn - rates.waterUse) * dt));
  advanceGrowth(s, CONFIG.growth.speed * m.growthSpeed * growthClimate(s) * oceanSpeed(s) * dt);
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

/** Tiefsee-Fäden wachsen langsamer. */
const oceanSpeed = (s: GameState): number => (s.growth?.ocean ? CONFIG.zone4.oceanSpeed : 1);

/** Fäden in die Tropen wachsen schneller, in die Taiga langsamer. */
function growthClimate(s: GameState): number {
  const t = s.growth ? s.nodes[s.growth.to] : null;
  return t ? climateOf(t).growth : 1;
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
    else if (target.owner > 0) {
      releaseNode(s, target);
      bump(s, 'reclaim');
    }
    bump(s, 'connect');
    bump(s, 'connect_type', 1, target.type);
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
    if (s.zone === 2 && c >= CONFIG.zone3.unlockAt) {
      s.zone = 3;
      s.meta.track.run.zone3At = s.stats.playSeconds;
      for (const r of s.rivals) if (s.nodes[r.core]?.zone === 3) r.nextAt = s.stats.playSeconds + CONFIG.rivals.interval * 2;
    }
    if (s.stats.zone3DoneAt === null && c >= CONFIG.zone3.goal) s.stats.zone3DoneAt = s.stats.playSeconds;
    if (s.zone === 3 && c >= CONFIG.zone4.unlockAt) {
      s.zone = 4;
      s.meta.track.run.zone4At = s.stats.playSeconds;
      for (const r of s.rivals) if (s.nodes[r.core]?.zone === 4) r.nextAt = s.stats.playSeconds + CONFIG.zone4.boss.interval * 2;
    }
    s.meta.lifetime.maxZone = Math.max(s.meta.lifetime.maxZone, s.zone);
    checkPlanetDone(s);
  }
}

/** Der Riesen-Schleimpilz (Rivale in Zone 4) – oder undefined, wenn die Karte keinen hat. */
export function boss(s: GameState): Rival | undefined {
  return s.rivals.find((r) => s.nodes[r.core]?.zone === 4);
}

/** Finale: 150 Knoten und der Schleimpilz ist besiegt. */
export function checkPlanetDone(s: GameState): boolean {
  if (s.zone < 4 || s.stats.zone4DoneAt !== null) return false;
  if (connectedCount(s) < CONFIG.zone4.goal || boss(s)?.alive) return false;
  s.stats.zone4DoneAt = s.stats.playSeconds;
  s.meta.lifetime.planets++;
  return true;
}

// ---------- Konkurrenzpilze ----------

function initRivals(s: GameState): void {
  s.rivals = [];
  for (const n of s.nodes) {
    if (n.type !== 'rivale') continue;
    n.owner = s.rivals.length + 1;
    const reach = n.zone === 4 ? CONFIG.zone4.boss.reach : n.zone === 3 ? CONFIG.zone3.rivalReach : CONFIG.rivals.reach;
    s.rivals.push({ core: n.id, edges: [], nextAt: 0, alive: true, reach });
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
  const isBoss = s.nodes[r.core]?.zone === 4;
  const reward = computeRates(s).n * (isBoss ? CONFIG.zone4.boss.rewardSeconds : CONFIG.rivals.defeatRewardSeconds);
  addNutrients(s, Math.max(reward, 100));
  s.meta.lifetime.rivalsBeaten++;
  if (isBoss) s.meta.lifetime.bossBeaten++;
}

/** Ein Rivale besetzt den nächstgelegenen freien Knoten in Reichweite seines Netzes. */
export function rivalStep(s: GameState, index: number): MapNode | null {
  const r = s.rivals[index];
  if (!r || !r.alive) return null;
  const owned = s.nodes.filter((n) => n.owner === index + 1);
  // jeder Rivale bleibt in seiner eigenen Zone
  const zone = s.nodes[r.core]?.zone ?? 2;
  // der Schleimpilz kann nicht schwimmen – er bleibt auf seinem Kontinent
  const geo = zone === 4 ? planetGeography(s.seed) : null;
  let best: MapNode | null = null;
  let bestFrom: MapNode | null = null;
  let bestD = Infinity;
  for (const n of s.nodes) {
    if (n.zone !== zone || n.connected || n.owner !== 0 || n.type === 'stein' || n.type === 'rivale') continue;
    if (s.growth?.to === n.id) continue;
    for (const o of owned) {
      const d = Math.hypot(o.x - n.x, o.y - n.y);
      if (d <= r.reach && d < bestD && pathClear(s, o, n) && !(geo && segmentCrossesOcean(geo, o.x, o.y, n.x, n.y))) {
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
    const zone = s.nodes[r.core]?.zone ?? 2;
    if (!r.alive || zone > s.zone || now < r.nextAt) return;
    const b = CONFIG.zone4.boss;
    if (zone === 4) r.nextAt = now + (offline ? b.offlineInterval : b.interval) * mods(s).bossSlow;
    else r.nextAt = now + (offline ? CONFIG.rivals.offlineInterval : CONFIG.rivals.interval);
    const max = zone === 4 ? b.maxReach : zone === 3 ? CONFIG.zone3.rivalMaxReach : CONFIG.rivals.maxReach;
    if (!rivalStep(s, i) && r.reach < max) {
      // nichts in Reichweite: weiter ausgreifen und bald erneut versuchen
      r.reach = Math.min(max, r.reach + (zone === 4 ? b.reachStep : CONFIG.rivals.reachStep * (zone === 3 ? 2.5 : 1)));
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
  const windW = s.zone >= 3 ? c.weights.wind * mul(s, 'w1', CONFIG.genomeEffects.w1Wind) : 0;
  const weights = { ...c.weights, duerre: hasTree ? c.weights.duerre : 0, wind: windW };
  const total = weights.regen + weights.duerre + weights.gold + weights.wind;
  let roll = rng() * total;
  let type: EventType = 'regen';
  for (const t of ['regen', 'duerre', 'gold', 'wind'] as EventType[]) {
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
  const dur = c[type].duration * (type === 'wind' ? 1 + 0.5 * lv(s, 'w1') : 1);
  ev.active = { type, until: now + dur };
  if (type === 'regen') s.meta.lifetime.rainSeen++;
  if (type === 'wind') s.meta.lifetime.windSeen++;
}

/** Goldenen Fruchtkörper einsammeln: Bonus = 60 s Produktion. */
export function catchGolden(s: GameState): number {
  if (!s.events.golden) return 0;
  const reward = Math.max(CONFIG.events.gold.minReward * mods(s).global, computeRates(s).n * CONFIG.events.gold.rewardSeconds);
  addNutrients(s, reward);
  s.events.golden = null;
  s.meta.lifetime.goldCaught++;
  bump(s, 'gold');
  return reward;
}

// ---------- Aktionen ----------

export function tap(s: GameState): number {
  const v = tapValue(s);
  addNutrients(s, v);
  s.stats.taps++;
  bump(s, 'taps');
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

/**
 * Bester Ausgangsknoten für einen Faden: der nächste verbundene Knoten in Reichweite.
 * Ein Weg über Land wird einem Tiefsee-Faden immer vorgezogen; über Wasser geht es nur mit „Tiefsee-Hyphen“.
 */
export function findSourceInfo(s: GameState, targetId: number): { node: MapNode; ocean: boolean } | null {
  const target = s.nodes[targetId];
  if (!target || target.connected || target.type === 'stein' || target.zone > s.zone) return null;
  if (target.type === 'rivale' && !s.rivals[target.owner - 1]?.alive) return null;
  const maxReach = reach(s);
  const coast = CONFIG.zone4.coast;
  const geo = s.zone >= 4 ? planetGeography(s.seed) : null;
  const canSwim = s.levels.tiefsee > 0;
  let land: MapNode | null = null;
  let landD = Infinity;
  let sea: MapNode | null = null;
  let seaD = Infinity;
  for (const node of s.nodes) {
    if (!node.connected) continue;
    const d = Math.hypot(node.x - target.x, node.y - target.y);
    if (d > maxReach || d >= landD) continue;
    const ocean = !!geo && (target.dist > coast || node.dist > coast) && segmentCrossesOcean(geo, node.x, node.y, target.x, target.y);
    // gibt es schon einen Landweg, ist jeder Seeweg unnötig
    if (ocean && (land || !canSwim || d >= seaD)) continue;
    if (!pathClear(s, node, target)) continue;
    if (ocean) {
      sea = node;
      seaD = d;
    } else {
      land = node;
      landD = d;
    }
  }
  if (land) return { node: land, ocean: false };
  return sea ? { node: sea, ocean: true } : null;
}

export function findSource(s: GameState, targetId: number): MapNode | null {
  return findSourceInfo(s, targetId)?.node ?? null;
}

/** Kosten eines Fadens; besetzte Knoten und Rivalen-Kerne kosten ein Vielfaches. */
export function growthCost(s: GameState, length: number, target?: MapNode, ocean = false, m: Mods = mods(s)): number {
  const g = CONFIG.growth;
  const n = m.count;
  const u = CONFIG.zone2.unlockAt;
  const u3 = CONFIG.zone3.unlockAt;
  const u4 = CONFIG.zone4.unlockAt;
  // Kostenanstieg wird mit jeder Zone flacher – sonst wären die großen Zonen unbezahlbar
  const scale =
    g.costPerNode ** Math.min(n, u) *
    CONFIG.zone2.costPerNode ** Math.max(0, Math.min(n, u3) - u) *
    CONFIG.zone3.costPerNode ** Math.max(0, Math.min(n, u4) - u3) *
    CONFIG.zone4.costPerNode ** Math.max(0, n - u4);
  const core = target?.zone === 4 ? CONFIG.zone4.boss.coreCost : CONFIG.rivals.coreCost;
  const extra = !target ? 1 : target.type === 'rivale' ? core : target.owner > 0 ? CONFIG.rivals.reclaimCost : 1;
  // Sporenwind trägt die Fäden – sie kosten nur einen Bruchteil
  const wind = eventActive(s, 'wind') ? CONFIG.events.wind.cost : 1;
  return g.costPerUnit * length * scale * m.growthCost * extra * wind * (ocean ? m.ocean : 1);
}

export type GrowResult = { ok: true } | { ok: false; reason: 'busy' | 'unreachable' | 'cost' };

export function growthQuote(s: GameState, targetId: number): { source: MapNode; length: number; cost: number; ocean: boolean } | null {
  const target = s.nodes[targetId];
  const info = findSourceInfo(s, targetId);
  if (!target || !info) return null;
  const source = info.node;
  const length = Math.hypot(source.x - target.x, source.y - target.y);
  return { source, length, cost: growthCost(s, length, target, info.ocean), ocean: info.ocean };
}

export function startGrowth(s: GameState, targetId: number): GrowResult {
  if (s.growth) return { ok: false, reason: 'busy' };
  const q = growthQuote(s, targetId);
  if (!q) return { ok: false, reason: 'unreachable' };
  if (s.res.n < q.cost) return { ok: false, reason: 'cost' };
  s.res.n -= q.cost;
  s.growth = { from: q.source.id, to: targetId, length: q.length, progress: 0, ...(q.ocean ? { ocean: true } : {}) };
  return { ok: true };
}

export function upgradeDef(id: UpgradeId): UpgradeDef {
  const def = CONFIG.upgrades.find((u) => u.id === id);
  if (!def) throw new Error(`Unbekanntes Upgrade: ${id}`);
  return def;
}

export function upgradeCost(s: GameState, id: UpgradeId): Cost {
  const def = upgradeDef(id);
  const f = def.growth ** s.levels[id];
  return { n: def.baseCost.n * f, sugar: def.baseCost.sugar * f, min: def.baseCost.min * f };
}

export function upgradeUnlocked(s: GameState, id: UpgradeId): boolean {
  const u = upgradeDef(id).unlock;
  if (u === 'zone4') return s.zone >= 4;
  return u === 'none' || (u === 'sugar' ? sugarUnlocked(s) : mineralsUnlocked(s));
}

export function canBuy(s: GameState, id: UpgradeId): boolean {
  if (!upgradeUnlocked(s, id)) return false;
  const c = upgradeCost(s, id);
  return s.res.n >= c.n && s.res.sugar >= c.sugar && s.res.minerals >= c.min;
}

export function buy(s: GameState, id: UpgradeId): boolean {
  if (!canBuy(s, id)) return false;
  const c = upgradeCost(s, id);
  s.res.n -= c.n;
  s.res.sugar -= c.sugar;
  s.res.minerals -= c.min;
  s.levels[id]++;
  bump(s, 'buy');
  return true;
}

// ---------- Sporenflug & Genom ----------

/** Faktor aus verbundenen Hexenringen (+25 % Sporen je Ring, mit „Hexenmeister“ doppelt). */
export function hexBonus(s: GameState): number {
  const rings = s.nodes.reduce((c, n) => c + (n.connected && n.type === 'hexenring' ? 1 : 0), 0);
  return 1 + rings * CONFIG.zone3Nodes.hexenring.sporeBonus * mods(s).hex;
}

/** Sporen vor der Dämpfung (Wurzel aus den Nährstoffen dieses Durchlaufs, mal Hexenring-Bonus). */
export function sporeGainRaw(s: GameState): number {
  return Math.sqrt(s.stats.totalN / CONFIG.prestige.divisor) * hexBonus(s);
}

/** Dämpfung: bis zur Grenze unverändert, darüber wächst der Ertrag deutlich langsamer. */
export function dampSpores(raw: number): number {
  const { softCap: cap, softCapExp: e, softCap2: cap2 } = CONFIG.prestige;
  const d = raw <= cap ? raw : cap * (raw / cap) ** e;
  return d <= cap2 ? d : cap2 * (d / cap2) ** e;
}

export function sporeGain(s: GameState): number {
  return Math.floor(dampSpores(sporeGainRaw(s)));
}

export function canPrestige(s: GameState): boolean {
  return connectedCount(s) >= CONFIG.prestige.minNodes && sporeGain(s) >= 1;
}

/** Neuer Wald, gleiche Meta-Daten plus die gewonnenen Sporen. */
/** Zusammenfassung des laufenden Durchlaufs für die Statistik */
export function runRecord(s: GameState, now: number, spores: number): RunRecord {
  const r = s.meta.track.run;
  return {
    n: s.meta.runs + 1,
    startedAt: r.startedAt,
    endedAt: now,
    playSec: Math.round(s.stats.playSeconds),
    realSec: Math.round(r.realActive),
    testSec: Math.round(r.testReal),
    offlineSec: Math.round(r.offline),
    nodes: connectedCount(s),
    zone: s.zone,
    spores,
    zone1DoneAt: s.stats.zoneDoneAt === null ? null : Math.round(s.stats.zoneDoneAt),
    zone2At: s.zone2Since === null ? null : Math.round(s.zone2Since),
    zone2DoneAt: s.stats.zone2DoneAt === null ? null : Math.round(s.stats.zone2DoneAt),
    zone3At: r.zone3At === null ? null : Math.round(r.zone3At),
    zone3DoneAt: s.stats.zone3DoneAt === null ? null : Math.round(s.stats.zone3DoneAt),
    zone4At: r.zone4At === null ? null : Math.round(r.zone4At),
    zone4DoneAt: s.stats.zone4DoneAt === null ? null : Math.round(s.stats.zone4DoneAt),
  };
}

export function prestige(s: GameState, newSeed = Math.floor(Math.random() * 2 ** 31), now = Date.now()): GameState | null {
  if (!canPrestige(s)) return null;
  const gain = sporeGain(s);
  const meta: Meta = {
    ...s.meta,
    spores: s.meta.spores + gain,
    sporesTotal: s.meta.sporesTotal + gain,
    runs: s.meta.runs + 1,
    genome: [...s.meta.genome],
    genomeLevels: { ...s.meta.genomeLevels },
    daily: structuredClone(s.meta.daily),
    track: structuredClone(s.meta.track),
    achievements: [...s.meta.achievements],
    lifetime: { ...s.meta.lifetime },
  };
  // Statistik: Durchlauf abschließen, neuen beginnen
  meta.track.history.push(runRecord(s, now, gain));
  if (meta.track.history.length > 100) meta.track.history.shift();
  meta.track.run = newRunTrack(now);
  const next = newGame(newSeed, meta);
  bump(next, 'prestige');
  return next;
}

export function genomeDef(id: GenomeId): GenomeDef {
  const d = CONFIG.genome.find((g) => g.id === id);
  if (!d) throw new Error(`Unbekannte Mutation: ${id}`);
  return d;
}

/** Nächste Stufe kaufbar? (Stufe 1 braucht die Mutation davor im selben Ast) */
export function genomeAvailable(s: GameState, id: GenomeId): boolean {
  if (lv(s, id) >= CONFIG.genomeMaxLevel) return false;
  if (has(s, id)) return true;
  const d = genomeDef(id);
  // Weltenpilz erst, wenn man den Planeten einmal erreicht hat
  if (d.branch === 'weltenpilz' && s.meta.lifetime.maxZone < 4) return false;
  if (d.tier === 1) return true;
  const prev = CONFIG.genome.find((g) => g.branch === d.branch && g.tier === d.tier - 1);
  return !!prev && has(s, prev.id);
}

/** Preis der nächsten Stufe in Sporen. */
export function genomeCost(s: GameState, id: GenomeId): number {
  return Math.round(genomeDef(id).cost * CONFIG.genomeCostGrowth ** lv(s, id));
}

export function buyGenome(s: GameState, id: GenomeId): boolean {
  if (!genomeAvailable(s, id)) return false;
  const cost = genomeCost(s, id);
  if (s.meta.spores < cost) return false;
  s.meta.spores -= cost;
  bump(s, 'genome');
  if (!has(s, id)) s.meta.genome.push(id);
  else s.meta.genomeLevels[id] = lv(s, id) + 1;
  return true;
}
