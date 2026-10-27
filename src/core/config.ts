/**
 * Zentrale Balancing-Konfiguration.
 * Alle Spielzahlen stehen hier – nirgendwo sonst im Code.
 * Die Balancing-Simulation (scripts/simulate.ts) liest dieselben Werte.
 */

export type NodeType = 'spore' | 'laub' | 'totholz' | 'feucht' | 'baum' | 'stein';
export type UpgradeId = 'hyphen' | 'enzym' | 'frucht' | 'rhizo';
export type GenomeId = 'z1' | 'z2' | 'z3' | 'z4' | 's1' | 's2' | 's3' | 's4' | 'p1' | 'p2' | 'p3' | 'p4';
export type Branch = 'zersetzer' | 'symbiont' | 'pionier';
export type EventType = 'regen' | 'duerre' | 'gold';

export interface GenomeDef {
  id: GenomeId;
  branch: Branch;
  tier: number; // 1..4, jede Stufe braucht die vorige im selben Ast
  cost: number; // Sporen
}

export interface UpgradeDef {
  id: UpgradeId;
  baseCost: { n: number; sugar: number };
  growth: number; // Kostenfaktor pro Stufe
  requiresSugar: boolean; // erst sichtbar, wenn Zucker freigeschaltet ist
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
    weights: { laub: 40, totholz: 20, feucht: 11, baum: 13, stein: 16 } as Record<Exclude<NodeType, 'spore'>, number>,
    /** Knotenradien in Welteinheiten (Darstellung + Kollision). */
    radius_by_type: { spore: 14, laub: 9, totholz: 13, feucht: 11, baum: 16, stein: 18 } as Record<NodeType, number>,
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
  },

  waterCap: 100,

  upgrades: [
    { id: 'hyphen', baseCost: { n: 15, sugar: 0 }, growth: 1.3, requiresSugar: false },
    { id: 'enzym', baseCost: { n: 60, sugar: 0 }, growth: 1.3, requiresSugar: false },
    { id: 'frucht', baseCost: { n: 120, sugar: 4 }, growth: 1.22, requiresSugar: true },
    { id: 'rhizo', baseCost: { n: 250, sugar: 10 }, growth: 1.3, requiresSugar: true },
  ] as UpgradeDef[],

  effects: {
    hyphenTap: 1, // +Ertrag pro Tipp und Stufe
    enzymDecomp: 0.2, // +20 % Zersetzung (Laub, Totholz) pro Stufe
    fruchtNps: 1.5, // Nährstoffe/s pro Fruchtkörper
    rhizoCost: 0.9, // Fadenkosten × 0.9 pro Stufe
    rhizoSpeed: 0.25, // +25 % Wachstumstempo pro Stufe
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
  },

  events: {
    firstAt: 150, // Sekunden Spielzeit bis zum ersten Ereignis
    minGap: 180,
    maxGap: 420,
    weights: { regen: 45, duerre: 25, gold: 30 } as Record<EventType, number>,
    regen: { duration: 60, growth: 2, water: 3 },
    duerre: { duration: 90, water: 0.3, offlineWater: 0.65 },
    gold: { duration: 12, rewardSeconds: 60, minReward: 50 },
  },

  /** +2 % Nährstoffe je freigeschaltetem Erfolg */
  achievementBonus: 0.02,

  offlineCapSeconds: 12 * 3600,
  autosaveSeconds: 30,
} as const;
