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
const MAX_SECONDS = 12 * 3600;
const MILESTONES = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60];

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
    case 'altbaum':
      value = 8;
      break;
    case 'rivale':
      value = 30;
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
  state: GameState;
  seconds: number;
}

interface RunOptions {
  start?: GameState;
  goal?: number;
  /** Abbruch, z. B. für einen Sporenflug: bekommt Zeit seit dem letzten neuen Knoten */
  stopWhen?: (s: GameState, sinceNode: number) => boolean;
  maxSeconds?: number;
}

/** Spielt einen Durchlauf. Schritt 0,25 s – genau genug und schnell. */
function run(profile: Profile, seed: number, opt: RunOptions = {}): RunResult {
  const s = opt.start ?? newGame(seed);
  const goal = opt.goal ?? CONFIG.zoneGoal;
  const max = opt.maxSeconds ?? MAX_SECONDS;
  const dt = 0.25;
  const milestones: Record<number, number | null> = Object.fromEntries(MILESTONES.map((m) => [m, null]));
  let t = 0;
  let nextCheck = 0;
  let tapAcc = 0;
  let lastAction = 0;
  let longestGap = 0;
  let lastCount = connectedCount(s);
  let lastNodeAt = 0;
  while (t < max && connectedCount(s) < goal) {
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
      if (opt.stopWhen?.(s, t - lastNodeAt)) break;
    }
    tick(s, dt);
    t += dt;
    const c = connectedCount(s);
    if (c > lastCount) {
      lastCount = c;
      lastNodeAt = t;
    }
    for (const m of MILESTONES) if (milestones[m] === null && c >= m) milestones[m] = t;
  }
  return { milestones, longestGap, finalNps: computeRates(s).n, levels: { ...s.levels }, state: s, seconds: t };
}

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
};

let problems = 0;

// ---------- Teil 1: erster Durchlauf, Zone 1 ----------
for (const p of PROFILES) {
  console.log(`\n=== Zone 1 · ${p.name} – ${SEEDS.length} Karten ===`);
  const results = SEEDS.map((seed) => run(p, seed));
  for (const m of MILESTONES.filter((x) => x <= CONFIG.zoneGoal)) {
    const times = results.map((r) => r.milestones[m]).filter((x): x is number => x !== null);
    const label = `${String(m).padStart(2)} Knoten`;
    if (times.length < results.length) {
      console.log(`${label}: nur ${times.length}/${results.length} Karten erreicht`);
      if (m === CONFIG.zoneGoal) problems++;
    } else console.log(`${label}: Median ${formatDuration(median(times))}  (min ${formatDuration(Math.min(...times))}, max ${formatDuration(Math.max(...times))})`);
  }
  const gap = median(results.map((r) => r.longestGap));
  console.log(`Längste Pause ohne Aktion (Median): ${formatDuration(gap)}`);
  const zone = results.map((r) => r.milestones[CONFIG.zoneGoal]).filter((x): x is number => x !== null);
  // Ziel: Zone 1 aktiv in 10–45 Minuten (schnell genug zum Testen, lang genug für Entscheidungen)
  if (p.active && zone.length && (median(zone) < 600 || median(zone) > 2700)) {
    console.log('  ⚠ Zone-1-Dauer liegt außerhalb des Ziels von 10–45 Minuten');
    problems++;
  }
  if (p.active && gap > 180) {
    console.log('  ⚠ Tote Phase: aktiver Spieler wartet über 3 Minuten');
    problems++;
  }
}

// ---------- Teil 2: Kampagne mit Sporenflügen bis Zone 2 geschafft ----------
const GENOME_ORDER = ['p1', 'z1', 's1', 'p2', 'z2', 's2', 'p3', 'z3', 's3', 'p4', 'z4', 's4'] as const;
/** Ein vernünftiger Spieler fliegt, wenn er 5 Min. keinen Knoten mehr schafft und der Flug sich lohnt. */
const shouldFly = (s: GameState, sinceNode: number) =>
  sinceNode > 300 && sporeGain(s) >= Math.max(3, 0.25 * s.meta.sporesTotal) && connectedCount(s) >= CONFIG.prestige.minNodes;

for (const p of [PROFILES[0]!, PROFILES[1]!]) {
  console.log(`\n=== Kampagne bis ${CONFIG.zone2.goal} Knoten · ${p.name} – 4 Karten ===`);
  const totals: number[] = [];
  const gaps: number[] = [];
  for (const seed of SEEDS.slice(0, 4)) {
    let state: GameState | undefined;
    let total = 0;
    let zone2At: number | null = null;
    let done = false;
    let runs = 0;
    let worstGap = 0;
    const lines: string[] = [];
    while (!done && runs < 40 && total < 40 * 3600) {
      const res = run(p, seed * 1000 + runs, { start: state, goal: CONFIG.zone2.goal, stopWhen: shouldFly, maxSeconds: 6 * 3600 });
      if (zone2At === null && res.milestones[CONFIG.zone2.unlockAt] !== null) zone2At = total + res.milestones[CONFIG.zone2.unlockAt]!;
      total += res.seconds;
      runs++;
      if (runs > 1) worstGap = Math.max(worstGap, res.longestGap);
      lines.push(`${formatDuration(res.seconds)}/${connectedCount(res.state)}K/+${sporeGain(res.state)}Sp`);
      if (connectedCount(res.state) >= CONFIG.zone2.goal) {
        done = true;
        break;
      }
      const next = prestige(res.state, seed * 1000 + runs);
      if (!next) break;
      for (const id of GENOME_ORDER) if (genomeAvailable(next, id)) buyGenome(next, id);
      state = next;
    }
    totals.push(done ? total : Infinity);
    gaps.push(worstGap);
    console.log(`Karte ${seed}: ${done ? 'geschafft' : 'NICHT geschafft'} in ${formatDuration(total)}, ${runs} Durchläufe, Zone 2 ab ${zone2At === null ? '–' : formatDuration(zone2At)}`);
    console.log(`  ${lines.join(' → ')}`);
  }
  const med = median(totals);
  console.log(`Gesamtzeit bis Zone 2 geschafft (Median): ${Number.isFinite(med) ? formatDuration(med) : 'nicht erreicht'}`);
  console.log(`Längste Pause ab Durchlauf 2 (Median): ${formatDuration(median(gaps))}`);
  if (p.active) {
    // Ziel: selbst der Dauertipper (5 Tipps/s ohne Pause – die obere Grenze) braucht 2–12 Std. reine Spielzeit.
    // Normale Spieler liegen deutlich darüber und verteilen das auf mehrere Tage.
    if (!(med >= 2 * 3600 && med <= 12 * 3600)) {
      console.log('  ⚠ Zone-2-Gesamtdauer liegt außerhalb von 2–12 Stunden');
      problems++;
    }
    if (median(gaps) > 300) {
      console.log('  ⚠ Tote Phasen über 5 Minuten in späteren Durchläufen');
      problems++;
    }
  }
}

console.log(problems ? `\n${problems} Balancing-Problem(e) gefunden.` : '\nKeine Balancing-Probleme gefunden.');
if (problems) process.exit(1);
