import { CONFIG } from './config';
import { connectedCount, type GameState } from './game';

/**
 * Erfolge: jeder gibt dauerhaft +2 % Nährstoffe (CONFIG.achievementBonus).
 * Texte stehen in der Sprachdatei unter ach_<id> und ach_<id>_desc.
 */
export interface AchievementDef {
  id: string;
  check: (s: GameState) => boolean;
}

const countType = (s: GameState, type: string) => s.nodes.filter((n) => n.connected && n.type === type).length;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_link', check: (s) => connectedCount(s) >= 1 },
  { id: 'net_10', check: (s) => connectedCount(s) >= 10 },
  { id: 'net_25', check: (s) => connectedCount(s) >= CONFIG.zoneGoal },
  { id: 'net_40', check: (s) => connectedCount(s) >= 40 },
  { id: 'tree', check: (s) => countType(s, 'baum') >= 1 },
  { id: 'forest', check: (s) => countType(s, 'baum') >= 3 },
  { id: 'water', check: (s) => countType(s, 'feucht') >= 1 },
  { id: 'eaten', check: (s) => s.nodes.some((n) => n.connected && n.type === 'totholz' && n.stock <= 0) },
  { id: 'n_1k', check: (s) => s.meta.lifetime.totalN >= 1e3 },
  { id: 'n_100k', check: (s) => s.meta.lifetime.totalN >= 1e5 },
  { id: 'n_10m', check: (s) => s.meta.lifetime.totalN >= 1e7 },
  { id: 'n_1b', check: (s) => s.meta.lifetime.totalN >= 1e9 },
  { id: 'taps_100', check: (s) => s.meta.lifetime.taps >= 100 },
  { id: 'taps_1k', check: (s) => s.meta.lifetime.taps >= 1000 },
  { id: 'taps_10k', check: (s) => s.meta.lifetime.taps >= 10000 },
  { id: 'rain', check: (s) => s.meta.lifetime.rainSeen >= 1 },
  { id: 'gold_1', check: (s) => s.meta.lifetime.goldCaught >= 1 },
  { id: 'gold_10', check: (s) => s.meta.lifetime.goldCaught >= 10 },
  { id: 'spore_1', check: (s) => s.meta.runs >= 1 },
  { id: 'spore_5', check: (s) => s.meta.runs >= 5 },
  { id: 'genome_branch', check: (s) => ['z4', 's4', 'p4'].some((id) => s.meta.genome.includes(id as never)) },
  { id: 'genome_all', check: (s) => s.meta.genome.length >= CONFIG.genome.length },
];

/** Prüft alle Erfolge, trägt neue ein und gibt deren IDs zurück. */
export function checkAchievements(s: GameState): string[] {
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!s.meta.achievements.includes(a.id) && a.check(s)) {
      s.meta.achievements.push(a.id);
      fresh.push(a.id);
    }
  }
  return fresh;
}
