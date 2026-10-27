/**
 * Zentrale Balancing-Konfiguration.
 * Alle Spielzahlen stehen hier – nirgendwo sonst im Code.
 * Die Balancing-Simulation (scripts/simulate.ts) liest dieselben Werte.
 */

export type NodeType = 'spore' | 'laub' | 'totholz' | 'feucht' | 'baum' | 'stein';
export type UpgradeId = 'hyphen' | 'enzym' | 'frucht' | 'rhizo';

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

  offlineCapSeconds: 12 * 3600,
  autosaveSeconds: 30,
} as const;
