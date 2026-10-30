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
  { id: 'genome_branch', check: (s) => ['z4', 's4', 'p4', 'w4', 'o4'].some((id) => s.meta.genome.includes(id as never)) },
  { id: 'genome_all', check: (s) => s.meta.genome.length >= CONFIG.genome.length },
  { id: 'genome_max', check: (s) => Object.values(s.meta.genomeLevels).some((l) => (l ?? 0) >= CONFIG.genomeMaxLevel) },
  { id: 'zone2', check: (s) => s.zone >= 2 },
  { id: 'net_60', check: (s) => connectedCount(s) >= CONFIG.zone2.goal },
  { id: 'altbaum', check: (s) => countType(s, 'altbaum') >= 1 },
  { id: 'rival', check: (s) => s.meta.lifetime.rivalsBeaten >= 1 },
  { id: 'year', check: (s) => s.meta.lifetime.seasons === 0b1111 },
  { id: 'zone3', check: (s) => s.zone >= 3 },
  { id: 'net_100', check: (s) => connectedCount(s) >= CONFIG.zone3.goal },
  { id: 'moor', check: (s) => countType(s, 'moor') >= 1 },
  { id: 'hexenring', check: (s) => countType(s, 'hexenring') >= 1 },
  { id: 'minerals_1k', check: (s) => s.meta.lifetime.minerals >= 1000 },
  { id: 'wind', check: (s) => s.meta.lifetime.windSeen >= 1 },
  { id: 'climates', check: (s) => new Set(s.nodes.filter((n) => n.connected && n.climate).map((n) => n.climate)).size === 3 },
  // Zone 4 „Planet“
  { id: 'zone4', check: (s) => s.zone >= 4 },
  { id: 'ocean', check: (s) => s.nodes.some((n) => n.connected && n.zone === 4) },
  { id: 'koralle', check: (s) => countType(s, 'koralle') >= 3 },
  { id: 'vulkan', check: (s) => countType(s, 'vulkan') >= 1 },
  { id: 'urwald', check: (s) => countType(s, 'urwald') >= 1 },
  { id: 'boss', check: (s) => s.meta.lifetime.bossBeaten >= 1 },
  { id: 'planet', check: (s) => s.meta.lifetime.planets >= 1 },
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
