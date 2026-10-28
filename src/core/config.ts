/** Wird vom Build gesetzt: true im Release, sonst false (siehe scripts/build.ts). */
declare const __RELEASE__: boolean | undefined;
export const RELEASE: boolean = typeof __RELEASE__ !== 'undefined' && __RELEASE__;

/**
 * Zentrale Balancing-Konfiguration.
 * Alle Spielzahlen stehen hier – nirgendwo sonst im Code.
 * Die Balancing-Simulation (scripts/simulate.ts) liest dieselben Werte.
 */

export type NodeType =
  | 'spore'
  | 'laub'
  | 'totholz'
  | 'feucht'
  | 'baum'
  | 'stein'
  | 'altbaum'
  | 'rivale'
  | 'moor'
  | 'mineral'
  | 'hexenring';
export type Zone = 1 | 2 | 3;
export type Climate = 'tropen' | 'steppe' | 'taiga';
export type Season = 'fruehling' | 'sommer' | 'herbst' | 'winter';
export type UpgradeId = 'hyphen' | 'enzym' | 'frucht' | 'rhizo' | 'kristall' | 'fern';
export type GenomeId = 'z1' | 'z2' | 'z3' | 'z4' | 's1' | 's2' | 's3' | 's4' | 'p1' | 'p2' | 'p3' | 'p4' | 'w1' | 'w2' | 'w3' | 'w4';
export type Branch = 'zersetzer' | 'symbiont' | 'pionier' | 'wanderer';
export type EventType = 'regen' | 'duerre' | 'gold' | 'wind';

export interface GenomeDef {
  id: GenomeId;
  branch: Branch;
  tier: number; // 1..4, jede Stufe braucht die vorige im selben Ast
  cost: number; // Sporen
}

export interface Cost {
  n: number;
  sugar: number;
  min: number; // Mineralien
}

export interface UpgradeDef {
  id: UpgradeId;
  baseCost: Cost;
  growth: number; // Kostenfaktor pro Stufe
  /** erst sichtbar, wenn die Ressource freigeschaltet ist */
  unlock: 'none' | 'sugar' | 'minerals';
}

export const CONFIG = {
  /** Feste Simulationsschritte pro Sekunde. */
  ticksPerSecond: 10,

  map: {
    radius: 900,
    nodeCount: 230,
    minSpacing: 50,
    rockFreeRadius: 110,
    /** Typ-Gewichte für zufällige Knoten außerhalb des Startbereichs. */
    weights: { laub: 40, totholz: 20, feucht: 11, baum: 13, stein: 16 } as Record<'laub' | 'totholz' | 'feucht' | 'baum' | 'stein', number>,
    /** Knotenradien in Welteinheiten (Darstellung + Kollision). */
    radius_by_type: {
      spore: 14,
      laub: 9,
      totholz: 13,
      feucht: 11,
      baum: 16,
      stein: 18,
      altbaum: 30,
      rivale: 32,
      moor: 16,
      mineral: 14,
      hexenring: 18,
    } as Record<NodeType, number>,
  },

  /** Zone 2 „Wald“: ein Ring um Zone 1, größerer Maßstab. Wird an die Karte angehängt, Zone-1-Knoten bleiben unverändert. */
  zone2: {
    unlockAt: 25, // verbundene Knoten
    goal: 60,
    innerRadius: 950,
    outerRadius: 2600,
    nodeCount: 230,
    minSpacing: 150,
    sizeScale: 2, // Knoten sind größer
    weights: { laub: 34, totholz: 20, feucht: 12, baum: 12, altbaum: 6, stein: 16 } as Record<'laub' | 'totholz' | 'feucht' | 'baum' | 'altbaum' | 'stein', number>,
    rivals: 3,
    rivalMinDist: 1500,
    reachBonus: 170,
    speedBonus: 2,
    /** Kostenanstieg je Knoten jenseits von unlockAt (statt costPerNode) */
    costPerNode: 1.12,
  },

  /**
   * Zone 3 „Kontinent“: noch ein Ring, viel größerer Maßstab, drei Klimazonen.
   * Ebenfalls angehängt – Zone 1 und 2 bleiben unverändert.
   */
  zone3: {
    unlockAt: 60,
    goal: 100,
    innerRadius: 2800,
    outerRadius: 6500,
    nodeCount: 210,
    minSpacing: 330,
    sizeScale: 3.2,
    weights: { laub: 26, totholz: 16, feucht: 6, moor: 8, baum: 9, altbaum: 8, mineral: 11, hexenring: 3, stein: 13 } as Record<
      'laub' | 'totholz' | 'feucht' | 'moor' | 'baum' | 'altbaum' | 'mineral' | 'hexenring' | 'stein',
      number
    >,
    rivals: 2,
    rivalMinDist: 4500,
    rivalReach: 650,
    rivalMaxReach: 1600,
    reachBonus: 420, // zusätzlich zur Zone-2-Reichweite
    speedBonus: 2.5, // zusätzlich zum Zone-2-Tempo
    costPerNode: 1.14,
    /** Jenseits des Waldes wächst der Entfernungsbonus langsamer (sonst explodieren die Erträge) */
    distanceScaleOuter: 1400,
    /** Klima je Himmelsrichtung (Drittel des Kreises) */
    climate: {
      tropen: { yield: 1.5, growth: 1.2, water: 1 },
      steppe: { yield: 1, growth: 1, water: 0.5, totholz: 1.6 },
      taiga: { yield: 0.85, growth: 0.9, water: 1, noDrought: true },
    },
  },

  /** neue Knoten in Zone 3 */
  zone3Nodes: {
    moor: { water: 1.0, nps: 0.15 },
    mineral: { min: 0.4 }, // Mineralien/s (ohne Entfernungsbonus)
    hexenring: { sporeBonus: 0.25 }, // +25 % Sporen beim nächsten Sporenflug
  },

  rivals: {
    interval: 120, // Sekunden zwischen zwei Eroberungen eines Rivalen
    offlineInterval: 240,
    reach: 260, // Startreichweite eines Rivalen
    reachStep: 60, // findet er nichts, wächst seine Reichweite – er bleibt nie für immer stehen
    maxReach: 700,
    reclaimCost: 2.5, // Zurückerobern kostet ×2,5
    coreCost: 4, // Kern angreifen kostet ×4
    defeatRewardSeconds: 300, // Belohnung: 5 Min. Produktion
    coreNps: 3,
  },

  seasons: {
    length: 240, // Sekunden je Jahreszeit (nur ab Zone 2)
    order: ['fruehling', 'sommer', 'herbst', 'winter'] as Season[],
    fruehling: { growth: 1.3 },
    sommer: { sugar: 1.5, water: 0.8 },
    herbst: { laub: 2 },
    winter: { growth: 0.7, global: 0.85 },
  },

  /** Entfernungsbonus: Ertrag × (1 + Distanz / distanceScale). Weiter draußen = reicher. */
  distanceScale: 350,

  tap: { base: 1 },

  growth: {
    costPerUnit: 0.5,
    /** Kosten steigen pro bereits verbundenem Knoten um diesen Faktor. */
    costPerNode: 1.28,
    speed: 5, // Einheiten pro Sekunde
    tapBoost: 1.5, // Einheiten pro Tipp, solange ein Faden wächst
    reach: 150,
    reachPerRhizo: 20,
    rockClearance: 4,
  },

  nodes: {
    laub: { nps: 0.4 },
    totholz: { nps: 2.5, stockBase: 120, stockPerDistance: 1.2 },
    feucht: { water: 0.35 },
    baum: { waterUse: 0.2, sugar: 0.25 },
    altbaum: { waterUse: 0.5, sugar: 1.2 },
  },

  waterCap: 100,

  upgrades: [
    { id: 'hyphen', baseCost: { n: 15, sugar: 0, min: 0 }, growth: 1.3, unlock: 'none' },
    { id: 'enzym', baseCost: { n: 60, sugar: 0, min: 0 }, growth: 1.3, unlock: 'none' },
    { id: 'frucht', baseCost: { n: 120, sugar: 4, min: 0 }, growth: 1.22, unlock: 'sugar' },
    { id: 'rhizo', baseCost: { n: 250, sugar: 10, min: 0 }, growth: 1.3, unlock: 'sugar' },
    { id: 'kristall', baseCost: { n: 0, sugar: 0, min: 40 }, growth: 1.55, unlock: 'minerals' },
    { id: 'fern', baseCost: { n: 0, sugar: 0, min: 25 }, growth: 1.7, unlock: 'minerals' },
  ] as UpgradeDef[],

  effects: {
    hyphenTap: 1, // +Ertrag pro Tipp und Stufe
    enzymDecomp: 0.2, // +20 % Zersetzung (Laub, Totholz) pro Stufe
    fruchtNps: 1.5, // Nährstoffe/s pro Fruchtkörper
    rhizoCost: 0.9, // Fadenkosten × 0.9 pro Stufe
    rhizoSpeed: 0.25, // +25 % Wachstumstempo pro Stufe
    kristallGlobal: 0.25, // +25 % auf alle Nährstoffe pro Stufe (multiplikativ)
    fernReach: 120, // +120 Reichweite pro Stufe
  },

  /** Ziel des Prototyps (Zone 1). */
  zoneGoal: 25,

  /** Sporenflug (Prestige) */
  prestige: {
    minNodes: 15,
    /** Sporen = floor(sqrt(Nährstoffe dieses Durchlaufs / divisor)) */
    divisor: 2000,
    /** +2 % auf alle Nährstoffe je jemals gewonnener Spore */
    sporeBonus: 0.02,
  },

  genome: [
    { id: 'z1', branch: 'zersetzer', tier: 1, cost: 1 },
    { id: 'z2', branch: 'zersetzer', tier: 2, cost: 3 },
    { id: 'z3', branch: 'zersetzer', tier: 3, cost: 6 },
    { id: 'z4', branch: 'zersetzer', tier: 4, cost: 12 },
    { id: 's1', branch: 'symbiont', tier: 1, cost: 1 },
    { id: 's2', branch: 'symbiont', tier: 2, cost: 3 },
    { id: 's3', branch: 'symbiont', tier: 3, cost: 6 },
    { id: 's4', branch: 'symbiont', tier: 4, cost: 12 },
    { id: 'p1', branch: 'pionier', tier: 1, cost: 1 },
    { id: 'p2', branch: 'pionier', tier: 2, cost: 3 },
    { id: 'p3', branch: 'pionier', tier: 3, cost: 6 },
    { id: 'p4', branch: 'pionier', tier: 4, cost: 12 },
    { id: 'w1', branch: 'wanderer', tier: 1, cost: 15 },
    { id: 'w2', branch: 'wanderer', tier: 2, cost: 30 },
    { id: 'w3', branch: 'wanderer', tier: 3, cost: 50 },
    { id: 'w4', branch: 'wanderer', tier: 4, cost: 80 },
  ] as GenomeDef[],

  genomeEffects: {
    z1Decomp: 1.5, // Laub und Totholz ×1,5
    z2Stock: 1.5, // Totholz liefert ×1,5 aus seinem Vorrat
    z3Tap: 2, // Tipps ×2
    z4Laub: 2, // Laub ×2
    s1Sugar: 1.5, // Zucker ×1,5
    s2Water: 1.5, // Wasser ×1,5, Speicher ×3
    s2Cap: 3,
    s3Offline: 24 * 3600, // Offline-Grenze 24 Std.
    s4PerTree: 0.05, // +5 % Nährstoffe je verbundenem Baum
    p1Cost: 0.8, // Fäden ×0,8 Kosten
    p2Reach: 40, // +40 Reichweite
    p3Speed: 2, // Fäden ×2 Tempo
    p4Start: 1000, // Startvorrat pro Durchlauf
    w1Wind: 2, // Sporenwind doppelt so oft und 50 % länger
    w2Min: 2, // Mineralien ×2
    w3Hex: 2, // Hexenringe wirken doppelt
    w4PerNode: 0.01, // +1 % Nährstoffe je verbundenem Knoten
  },

  events: {
    firstAt: 150, // Sekunden Spielzeit bis zum ersten Ereignis
    minGap: 180,
    maxGap: 420,
    weights: { regen: 45, duerre: 25, gold: 30, wind: 25 } as Record<EventType, number>,
    regen: { duration: 60, growth: 2, water: 3 },
    duerre: { duration: 90, water: 0.3, offlineWater: 0.65 },
    gold: { duration: 12, rewardSeconds: 60, minReward: 50 },
    wind: { duration: 40, cost: 0.25 }, // nur ab Zone 3: Fäden kosten nur ein Viertel
  },

  /** +2 % Nährstoffe je freigeschaltetem Erfolg */
  achievementBonus: 0.02,

  /**
   * NUR ZUM TESTEN: Tempo-Regler (×1/×2/×5/×10) in den Einstellungen.
   * Im Release-Build (bun scripts/build.ts --release) automatisch aus – dann ist er komplett verschwunden.
   */
  testTools: !RELEASE,
  testSpeeds: [1, 2, 5, 10] as number[],

  offlineCapSeconds: 12 * 3600,
  autosaveSeconds: 30,
} as const;
