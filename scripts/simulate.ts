/**
 * Balancing-Simulation: Ein Bot spielt den Spielkern mit verschiedenen Spielstilen und Seeds durch.
 * Misst, wann Meilensteine erreicht werden, und findet "tote Phasen"
 * (lange Zeit ohne sinnvolle Aktion). Läuft ohne Grafik, in Sekunden.
 *
 *   bun scripts/simulate.ts
 */
import { CONFIG, type UpgradeId } from '../src/core/config';
import { checkAchievements } from '../src/core/achievements';
import {
  buy,
  buyGenome,
  catchGolden,
  genomeAvailable,
  prestige,
  sporeGain,
  canBuy,
  computeRates,
  connectedCount,
  growthQuote,
  newGame,
  startGrowth,
  tap,
  tick,
  upgradeCost,
  type GameState,
} from '../src/core/game';
import { formatDuration } from '../src/core/format';

interface Profile {
  name: string;
  /** Aktiver Spieler: für ihn gelten die Zeit- und Pausenziele. */
  active: boolean;
  /** Tipps pro Sekunde abhängig von der Spielzeit. */
  tapsPerSecond: (t: number) => number;
  /** Wie oft der Spieler nach Käufen schaut (Sekunden). */
  checkEvery: (t: number) => number;
}

const PROFILES: Profile[] = [
  { name: 'Aktiv (5 Tipps/s)', active: true, tapsPerSecond: () => 5, checkEvery: () => 1 },
  { name: 'Gelegentlich (2 Tipps/s, schaut alle 20 s)', active: false, tapsPerSecond: () => 2, checkEvery: () => 20 },
  {
    name: 'Idle (tippt nur 3 Min., dann alle 5 Min. reinschauen)',
    active: false,
    tapsPerSecond: (t) => (t < 180 ? 4 : 0),
    checkEvery: (t) => (t < 180 ? 1 : 300),
  },
];

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_SECONDS = 6 * 3600;
const MILESTONES = [1, 5, 10, 15, 20, 25];

/** Bewertet ein Ziel: neuer Ertrag pro Kosten (einfacher, gieriger Spieler). */
function targetScore(s: GameState, id: number, cost: number): number {
  const n = s.nodes[id]!;
  const bonus = 1 + n.dist / CONFIG.distanceScale;
  let value = 0;
  switch (n.type) {
    case 'laub':
      value = CONFIG.nodes.laub.nps * bonus;
      break;
    case 'totholz':
      value = n.stock / 120; // Vorrat über ca. 2 Min.
      break;
    case 'feucht':
      value = s.nodes.some((x) => x.connected && x.type === 'feucht') ? 0.2 : 3;
      break;
    case 'baum':
      value = 2.5;
      break;
    default:
      value = 0;
  }
  return value / Math.max(cost, 1);
}

function decide(s: GameState): string | null {
  // 1. Wachsen, wenn möglich
  if (!s.growth) {
    let best = -1;
    let bestScore = 0;
    let bestCost = 0;
    for (const n of s.nodes) {
      if (n.connected) continue;
      const q = growthQuote(s, n.id);
      if (!q) continue;
      const sc = targetScore(s, n.id, q.cost);
      if (sc > bestScore) {
        best = n.id;
        bestScore = sc;
        bestCost = q.cost;
      }
    }
    if (best >= 0 && s.res.n >= bestCost) {
      startGrowth(s, best);
      return 'grow';
    }
    // 2. Upgrade kaufen, wenn es deutlich günstiger als das nächste Wachstum ist
    const ids: UpgradeId[] = ['frucht', 'hyphen', 'enzym', 'rhizo'];
    for (const id of ids) {
      if (canBuy(s, id) && (best < 0 || upgradeCost(s, id).n < bestCost * 0.6)) {
        buy(s, id);
        return 'buy';
      }
    }
  } else {
    for (const id of ['frucht', 'hyphen', 'enzym', 'rhizo'] as UpgradeId[]) {
      if (canBuy(s, id)) {
        buy(s, id);
        return 'buy';
      }
    }
  }
  return null;
}

interface RunResult {
  milestones: Record<number, number | null>;
  longestGap: number;
  finalNps: number;
  levels: GameState['levels'];
}

function run(profile: Profile, seed: number, start?: GameState): RunResult & { state: GameState; seconds: number } {
  const s = start ?? newGame(seed);
  const dt = 1 / CONFIG.ticksPerSecond;
  const milestones: Record<number, number | null> = Object.fromEntries(MILESTONES.map((m) => [m, null]));
  let t = 0;
  let nextCheck = 0;
  let tapAcc = 0;
  let lastAction = 0;
  let longestGap = 0;
  while (t < MAX_SECONDS && connectedCount(s) < CONFIG.zoneGoal) {
    if (s.events.golden && profile.checkEvery(t) <= 1) catchGolden(s);
    tapAcc += profile.tapsPerSecond(t) * dt;
    while (tapAcc >= 1) {
      tap(s);
      tapAcc--;
    }
    if (t >= nextCheck) {
      while (decide(s)) {
        longestGap = Math.max(longestGap, t - lastAction);
        lastAction = t;
      }
      checkAchievements(s);
      nextCheck = t + profile.checkEvery(t);
    }
    tick(s, dt);
    t += dt;
    const c = connectedCount(s);
    for (const m of MILESTONES) if (milestones[m] === null && c >= m) milestones[m] = t;
  }
  return { milestones, longestGap, finalNps: computeRates(s).n, levels: { ...s.levels }, state: s, seconds: t };
}

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
};

let problems = 0;
for (const p of PROFILES) {
  console.log(`\n=== ${p.name} – ${SEEDS.length} Karten ===`);
  const results = SEEDS.map((seed) => run(p, seed));
  for (const m of MILESTONES) {
    const times = results.map((r) => r.milestones[m]).filter((x): x is number => x !== null);
    const label = `${String(m).padStart(2)} Knoten`;
    if (times.length < results.length) {
      console.log(`${label}: nur ${times.length}/${results.length} Karten erreicht`);
      if (m === CONFIG.zoneGoal) problems++;
    } else console.log(`${label}: Median ${formatDuration(median(times))}  (min ${formatDuration(Math.min(...times))}, max ${formatDuration(Math.max(...times))})`);
  }
  const gap = median(results.map((r) => r.longestGap));
  console.log(`Längste Pause ohne Aktion (Median): ${formatDuration(gap)}`);
  const lv = results[0]!.levels;
  console.log(`Upgrades (Karte 1): Hyphen ${lv.hyphen}, Enzym ${lv.enzym}, Frucht ${lv.frucht}, Rhizo ${lv.rhizo}`);
  const zone = results.map((r) => r.milestones[CONFIG.zoneGoal]).filter((x): x is number => x !== null);
  // Prototyp-Ziel: Zone 1 aktiv in 10–45 Minuten (schnell genug zum Testen, lang genug für Entscheidungen)
  if (p.active && zone.length && (median(zone) < 600 || median(zone) > 2700)) {
    console.log('  ⚠ Zone-1-Dauer liegt außerhalb des Ziels von 10–45 Minuten');
    problems++;
  }
  if (p.active && gap > 180) {
    console.log('  ⚠ Tote Phase: aktiver Spieler wartet über 3 Minuten');
    problems++;
  }
}
// ---------- Mehrere Durchläufe mit Sporenflug ----------
const GENOME_ORDER = ['p1', 'z1', 's1', 'p2', 'z2', 's2', 'p3', 'z3', 's3', 'p4', 'z4', 's4'] as const;
console.log('\n=== Sporenflug: aktiver Spieler, 6 Durchläufe, Flug bei Zone-Ziel ===');
const runTimes: number[][] = [];
for (const seed of SEEDS.slice(0, 4)) {
  let state: GameState | undefined;
  const times: number[] = [];
  const spores: number[] = [];
  for (let r = 0; r < 6; r++) {
    const res = run(PROFILES[0]!, seed * 100 + r, state);
    times.push(res.seconds);
    spores.push(sporeGain(res.state));
    const next = prestige(res.state, seed * 100 + r + 1);
    if (!next) break;
    for (const id of GENOME_ORDER) if (genomeAvailable(next, id)) buyGenome(next, id);
    state = next;
  }
  runTimes.push(times);
  console.log(`Karte ${seed}: ${times.map((x, i) => `${formatDuration(x)} (+${spores[i]} Sp.)`).join(' → ')}`);
}
for (let r = 1; r < 6; r++) {
  const prev = median(runTimes.map((x) => x[r - 1]!));
  const cur = median(runTimes.map((x) => x[r]!));
  if (!(cur < prev)) {
    console.log(`  ⚠ Durchlauf ${r + 1} ist nicht schneller als Durchlauf ${r}`);
    problems++;
  }
}

console.log(problems ? `\n${problems} Balancing-Problem(e) gefunden.` : '\nKeine Balancing-Probleme gefunden.');
if (problems) process.exit(1);
