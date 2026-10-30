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
  genomeCost,
  prestige,
  sporeGain,
  canBuy,
  computeRates,
  connectedCount,
  growthCost,
  growthQuote,
  newGame,
  startGrowth,
  tap,
  tick,
  upgradeCost,
  type GameState,
} from '../src/core/game';
import { formatDuration } from '../src/core/format';
import { applyOffline } from '../src/core/save';

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

/** --quick (für die automatische Prüfung bei GitHub): weniger Karten, gleiche Ziele */
const QUICK = process.argv.includes('--quick');
/** --offline: nur Teil 3 (Offline-Spieler) – zum schnellen Ausprobieren */
const ONLY_OFFLINE = process.argv.includes('--offline');
const SEEDS = QUICK ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_SECONDS = 12 * 3600;
const MILESTONES = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100];

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
    case 'moor':
      value = 4;
      break;
    case 'mineral':
      value = s.levels.kristall < 30 ? 12 : 3;
      break;
    case 'hexenring':
      value = 6;
      break;
    default:
      value = 0;
  }
  return value / Math.max(cost, 1);
}

/**
 * Erreichbare Ziele zwischenspeichern: Die Suche nach Quellknoten ist teuer, ändert sich aber nur,
 * wenn das Netz, die Reichweite oder die Besitzverhältnisse sich ändern. Kosten werden jedes Mal frisch berechnet.
 */
const reachCache = new WeakMap<GameState, { key: string; list: { id: number; length: number }[] }>();
function reachableTargets(s: GameState): { id: number; length: number }[] {
  const owned = s.nodes.reduce((c, n) => c + n.owner, 0);
  const key = `${s.edges.length}|${s.zone}|${s.levels.rhizo}|${s.levels.fern}|${s.meta.genome.length}:${Object.values(s.meta.genomeLevels).join('')}|${owned}`;
  const hit = reachCache.get(s);
  if (hit && hit.key === key) return hit.list;
  const list: { id: number; length: number }[] = [];
  for (const n of s.nodes) {
    if (n.connected) continue;
    const q = growthQuote(s, n.id);
    if (q) list.push({ id: n.id, length: q.length });
  }
  reachCache.set(s, { key, list });
  return list;
}

function decide(s: GameState): string | null {
  // 1. Wachsen, wenn möglich
  if (!s.growth) {
    let best = -1;
    let bestScore = 0;
    let bestCost = 0;
    for (const { id, length } of reachableTargets(s)) {
      const n = s.nodes[id]!;
      if (n.connected) continue;
      const cost = growthCost(s, length, n);
      const q = { cost };
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
    const ids: UpgradeId[] = ['kristall', 'fern', 'frucht', 'hyphen', 'enzym', 'rhizo'];
    for (const id of ids) {
      if (canBuy(s, id) && (best < 0 || upgradeCost(s, id).n < bestCost * 0.6)) {
        buy(s, id);
        return 'buy';
      }
    }
  } else {
    for (const id of ['kristall', 'fern', 'frucht', 'hyphen', 'enzym', 'rhizo'] as UpgradeId[]) {
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
for (const p of ONLY_OFFLINE ? [] : PROFILES) {
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
const GENOME_ORDER = ['p1', 'z1', 's1', 'p2', 'z2', 's2', 'p3', 'z3', 's3', 'p4', 'z4', 's4', 'w1', 'w2', 'w3', 'w4'] as const;
/** Ein vernünftiger Spieler fliegt, wenn er 5 Min. keinen Knoten mehr schafft und der Flug sich lohnt. */
const shouldFly = (s: GameState, sinceNode: number) =>
  sinceNode > 300 && sporeGain(s) >= Math.max(3, 0.25 * s.meta.sporesTotal) && connectedCount(s) >= CONFIG.prestige.minNodes;

interface CampaignTarget {
  goal: number;
  label: string;
  /** Spanne reiner Spielzeit für den Dauertipper (Sekunden) */
  activeBand: [number, number];
}
const TARGETS: CampaignTarget[] = [
  { goal: CONFIG.zone2.goal, label: 'Zone 2 geschafft', activeBand: [2 * 3600, 12 * 3600] },
  // seit 1.2 (Genom-Stufen, Tagesaufgaben) etwas schneller; Maßstab ist der normale Spieler mit ~15 Std.
  { goal: CONFIG.zone3.goal, label: 'Zone 3 geschafft', activeBand: [6 * 3600, 40 * 3600] },
];

for (const p of ONLY_OFFLINE ? [] : QUICK ? [PROFILES[0]!] : [PROFILES[0]!, PROFILES[1]!]) {
  console.log(`\n=== Kampagne bis ${CONFIG.zone3.goal} Knoten · ${p.name} – 4 Karten ===`);
  const reached: Record<number, number[]> = Object.fromEntries(TARGETS.map((x) => [x.goal, []]));
  const gaps: number[] = [];
  for (const seed of SEEDS.slice(0, QUICK ? 2 : 4)) {
    let state: GameState | undefined;
    let total = 0;
    let runs = 0;
    let worstGap = 0;
    const firstAt: Record<number, number> = {};
    const lines: string[] = [];
    while (runs < 60 && total < 60 * 3600) {
      const res = run(p, seed * 1000 + runs, { start: state, goal: CONFIG.zone3.goal, stopWhen: shouldFly, maxSeconds: 8 * 3600 });
      for (const tg of TARGETS) {
        const at = res.milestones[tg.goal];
        if (at !== null && at !== undefined && firstAt[tg.goal] === undefined) firstAt[tg.goal] = total + at;
      }
      total += res.seconds;
      runs++;
      if (runs > 1) worstGap = Math.max(worstGap, res.longestGap);
      lines.push(`${formatDuration(res.seconds)}/${connectedCount(res.state)}K/+${sporeGain(res.state)}Sp`);
      if (connectedCount(res.state) >= CONFIG.zone3.goal) break;
      const next = prestige(res.state, seed * 1000 + runs);
      if (!next) break;
      // erst alles freischalten, dann immer die günstigste nächste Stufe kaufen
      for (const id of GENOME_ORDER) if (!next.meta.genome.includes(id) && genomeAvailable(next, id)) buyGenome(next, id);
      for (;;) {
        const opts = GENOME_ORDER.filter((id) => genomeAvailable(next, id)).sort((a, b) => genomeCost(next, a) - genomeCost(next, b));
        if (!opts.length || !buyGenome(next, opts[0]!)) break;
      }
      state = next;
    }
    for (const tg of TARGETS) reached[tg.goal]!.push(firstAt[tg.goal] ?? Infinity);
    gaps.push(worstGap);
    console.log(
      `Karte ${seed}: ${runs} Durchläufe, ${TARGETS.map((tg) => `${tg.label}: ${firstAt[tg.goal] !== undefined ? formatDuration(firstAt[tg.goal]!) : '–'}`).join(', ')}`,
    );
    console.log(`  ${lines.slice(-6).join(' → ')}`);
  }
  for (const tg of TARGETS) {
    const med = median(reached[tg.goal]!);
    console.log(`${tg.label} (Median): ${Number.isFinite(med) ? formatDuration(med) : 'nicht erreicht'}`);
    if (p.active && !(med >= tg.activeBand[0] && med <= tg.activeBand[1])) {
      console.log(`  ⚠ ${tg.label}: außerhalb von ${formatDuration(tg.activeBand[0])} bis ${formatDuration(tg.activeBand[1])}`);
      problems++;
    }
  }
  console.log(`Längste Pause ab Durchlauf 2 (Median): ${formatDuration(median(gaps))}`);
  if (p.active && median(gaps) > 300) {
    console.log('  ⚠ Tote Phasen über 5 Minuten in späteren Durchläufen');
    problems++;
  }
}

// ---------- Teil 3: Offline-Spieler (wie das „Normal“-Handy) ----------
// Schaut ein paar Mal am Tag 3 Minuten rein, dazwischen arbeitet das Netz offline.
// Gemessen in echten Tagen. Wichtig gegen den „Sporen-Schneeball“: Sporen pro Flug.
const SESSION = 180;
const OFFLINE_GAP = 6 * 3600;
const offlineProfile: Profile = { name: 'Offline', active: false, tapsPerSecond: () => 2, checkEvery: () => 5 };
const buyAllGenome = (next: GameState) => {
  for (const id of GENOME_ORDER) if (!next.meta.genome.includes(id) && genomeAvailable(next, id)) buyGenome(next, id);
  for (;;) {
    const opts = GENOME_ORDER.filter((id) => genomeAvailable(next, id)).sort((a, b) => genomeCost(next, a) - genomeCost(next, b));
    if (!opts.length || !buyGenome(next, opts[0]!)) break;
  }
};
for (const eagerFly of QUICK ? [] : [false, true]) {
  console.log(`\n=== Offline-Spieler${eagerFly ? ' (fliegt eifrig)' : ''}: alle ${OFFLINE_GAP / 3600} Std. ${SESSION / 60} Min. reinschauen – ${ONLY_OFFLINE ? 4 : 3} Karten ===`);
  const z2: number[] = [];
  const z3: number[] = [];
  let maxGain = 0;
  for (const seed of SEEDS.slice(0, ONLY_OFFLINE ? 4 : 3)) {
    let state = newGame(seed * 77);
    let real = 0;
    let flights = 0;
    let lastCount = -1;
    const gains: number[] = [];
    let at2: number | undefined;
    let at3: number | undefined;
    while (real < 30 * 86400 && at3 === undefined) {
      // Am Anfang der Sitzung: fliegen, wenn seit der letzten Sitzung kein Knoten dazukam und es sich lohnt
      const c = connectedCount(state);
      const gain = sporeGain(state);
      // „eifrig“: fliegt, sobald sich die Sporen mindestens verdoppeln (wie auf dem Test-Handy beobachtet)
      const eager = eagerFly && gain >= Math.max(10, state.meta.sporesTotal);
      const stuck = c === lastCount && gain >= Math.max(3, 0.25 * state.meta.sporesTotal);
      if (c >= CONFIG.prestige.minNodes && (stuck || eager)) {
        const next = prestige(state, seed * 1000 + flights);
        if (next) {
          gains.push(gain);
          maxGain = Math.max(maxGain, gain);
          flights++;
          buyAllGenome(next);
          state = next;
        }
      }
      lastCount = connectedCount(state);
      const res = run(offlineProfile, 0, { start: state, goal: CONFIG.zone3.goal, maxSeconds: SESSION });
      state = res.state;
      real += res.seconds;
      if (at2 === undefined && connectedCount(state) >= CONFIG.zone2.goal) at2 = real;
      if (connectedCount(state) >= CONFIG.zone3.goal) {
        at3 = real;
        break;
      }
      applyOffline(state, 0, OFFLINE_GAP * 1000);
      real += OFFLINE_GAP;
      if (at2 === undefined && connectedCount(state) >= CONFIG.zone2.goal) at2 = real;
      if (connectedCount(state) >= CONFIG.zone3.goal) at3 = real;
    }
    z2.push(at2 ?? Infinity);
    z3.push(at3 ?? Infinity);
    const day = (x?: number) => (x === undefined ? '–' : `${(x / 86400).toFixed(1)} Tage`);
    console.log(`Karte ${seed}: Zone 2 nach ${day(at2)}, Zone 3 nach ${day(at3)}, ${flights} Flüge, Sporen je Flug: ${gains.join(', ')}`);
  }
  const md = (xs: number[]) => (Number.isFinite(median(xs)) ? `${(median(xs) / 86400).toFixed(1)} Tage` : 'nicht erreicht');
  console.log(`Zone 2 (Median): ${md(z2)} · Zone 3 (Median): ${md(z3)} · größter Flug: ${maxGain} Sporen`);
}

console.log(problems ? `\n${problems} Balancing-Problem(e) gefunden.` : '\nKeine Balancing-Probleme gefunden.');
if (problems) process.exit(1);
