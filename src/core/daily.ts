import type { NodeType } from './config';
import { createRng } from './rng';
import type { GameState } from './game';

/**
 * Tägliche Aufgaben: jeden Kalendertag drei neue, passend zur erreichten Zone.
 * Fortschritt wird über Zähler erfasst, die das Spiel bei Aktionen hochzählt (bump).
 * Belohnung: Sporen – mit wachsendem Spielfortschritt etwas mehr.
 */

export type QuestKind = 'connect' | 'connect_type' | 'taps' | 'gold' | 'buy' | 'reclaim' | 'prestige' | 'genome';

export interface Quest {
  kind: QuestKind;
  /** nur bei connect_type */
  nodeType?: NodeType;
  target: number;
  progress: number;
  claimed: boolean;
}

export interface Daily {
  day: string; // YYYY-MM-DD (Ortszeit)
  quests: Quest[];
  streak: number; // Tage in Folge alle Aufgaben abgeholt
  lastCompleteDay: string | null;
}

interface QuestTemplate {
  kind: QuestKind;
  nodeType?: NodeType;
  minZone: number;
  /** Zielwert abhängig von der Zone */
  target: (zone: number) => number;
}

const TEMPLATES: QuestTemplate[] = [
  { kind: 'connect', minZone: 1, target: (z) => [8, 12, 15, 12][z - 1] ?? 15 },
  { kind: 'connect_type', nodeType: 'totholz', minZone: 1, target: () => 3 },
  { kind: 'connect_type', nodeType: 'baum', minZone: 1, target: () => 2 },
  { kind: 'connect_type', nodeType: 'feucht', minZone: 1, target: () => 2 },
  { kind: 'taps', minZone: 1, target: () => 300 },
  { kind: 'gold', minZone: 1, target: () => 1 },
  { kind: 'buy', minZone: 1, target: (z) => [10, 20, 30][z - 1] ?? 30 },
  { kind: 'prestige', minZone: 1, target: () => 1 },
  { kind: 'connect_type', nodeType: 'altbaum', minZone: 2, target: () => 1 },
  { kind: 'reclaim', minZone: 2, target: () => 2 },
  { kind: 'genome', minZone: 2, target: () => 1 },
  { kind: 'connect_type', nodeType: 'moor', minZone: 3, target: () => 1 },
  { kind: 'connect_type', nodeType: 'mineral', minZone: 3, target: () => 2 },
  { kind: 'connect_type', nodeType: 'koralle', minZone: 4, target: () => 2 },
  { kind: 'connect_type', nodeType: 'vulkan', minZone: 4, target: () => 1 },
  { kind: 'connect_type', nodeType: 'urwald', minZone: 4, target: () => 1 },
];

/** Datum als YYYY-MM-DD in Ortszeit */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const hashString = (str: string): number => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Drei verschiedene Aufgaben für einen Tag – für alle Spieler mit gleicher Zone gleich. */
export function makeQuests(day: string, zone: number): Quest[] {
  const rng = createRng(hashString(`${day}|${zone}`));
  const pool = TEMPLATES.filter((t) => t.minZone <= zone);
  const picked: QuestTemplate[] = [];
  while (picked.length < 3 && pool.length) {
    picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return picked.map((t) => ({ kind: t.kind, nodeType: t.nodeType, target: t.target(zone), progress: 0, claimed: false }));
}

export function newDaily(): Daily {
  return { day: '', quests: [], streak: 0, lastCompleteDay: null };
}

/** Bei Tageswechsel neue Aufgaben. Gibt true zurück, wenn neue Aufgaben erzeugt wurden. */
export function rollDaily(s: GameState, day: string): boolean {
  const d = s.meta.daily;
  if (d.day === day) return false;
  // Serie bricht, wenn gestern nicht alles abgeholt wurde
  const yesterday = dayKey(new Date(new Date(`${day}T12:00:00`).getTime() - 864e5));
  if (d.lastCompleteDay !== yesterday && d.lastCompleteDay !== day) d.streak = 0;
  d.day = day;
  d.quests = makeQuests(day, s.zone);
  return true;
}

/** Fortschritt zählen. */
export function bump(s: GameState, kind: QuestKind, amount = 1, nodeType?: NodeType): void {
  for (const q of s.meta.daily.quests) {
    if (q.claimed || q.kind !== kind) continue;
    if (kind === 'connect_type' && q.nodeType !== nodeType) continue;
    q.progress = Math.min(q.target, q.progress + amount);
  }
}

export const questDone = (q: Quest): boolean => q.progress >= q.target;

/** Sporen-Belohnung: wächst mit dem Fortschritt, damit sie auch spät noch zählt. */
export function questReward(s: GameState): number {
  return 2 + Math.floor(s.meta.sporesTotal * 0.04);
}

/** Abholen. Gibt die Sporen zurück (0, wenn nicht möglich). Bonus für alle drei: Serie +1. */
export function claimQuest(s: GameState, index: number): number {
  const d = s.meta.daily;
  const q = d.quests[index];
  if (!q || q.claimed || !questDone(q)) return 0;
  q.claimed = true;
  let reward = questReward(s);
  if (d.quests.every((x) => x.claimed)) {
    d.streak++;
    d.lastCompleteDay = d.day;
    // Serienbonus: +1 Spore pro Tag in Folge, höchstens +7
    reward += Math.min(7, d.streak);
  }
  s.meta.spores += reward;
  s.meta.sporesTotal += reward;
  return reward;
}
