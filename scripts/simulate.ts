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
  boss,
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
  mods,
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
/** --campaign: nur die Kampagne des Dauertippers auf einer Karte, mit Laufzeit je Durchlauf (zum Ausprobieren) */
const ONLY_CAMPAIGN = process.argv.includes('--campaign');
/** --debug: lange Pausen mit Zustand ausgeben */
const DEBUG = process.argv.includes('--debug');
const SEEDS = QUICK ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6, 7, 8];
const MAX_SECONDS = 12 * 3600;
const MILESTONES = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];

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
      value = n.zone === 4 ? 0 : 30; // den Schleimpilz greift der Bot gezielt an (siehe decide)
      break;
    case 'vulkan':
      value = s.levels.kristall < 30 ? 20 : 5;
      break;
    case 'urwald':
      value = 14;
      break;
    case 'koralle':
      value = CONFIG.zone4Nodes.koralle.nps * bonus + 1;
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
type Target = { id: number; length: number; ocean: boolean };
const reachCache = new WeakMap<GameState, { key: string; list: Target[] }>();
function reachableTargets(s: GameState): Target[] {
  const owned = s.nodes.reduce((c, n) => c + n.owner, 0);
  const alive = s.rivals.map((r) => (r.alive ? 1 : 0)).join('');
  const key = `${s.edges.length}|${s.zone}|${s.levels.rhizo}|${s.levels.fern}|${s.levels.tiefsee > 0}|${s.meta.genome.length}:${Object.values(s.meta.genomeLevels).join('')}|${owned}|${alive}`;
  const hit = reachCache.get(s);
  if (hit && hit.key === key) return hit.list;
  const list: Target[] = [];
  for (const n of s.nodes) {
    if (n.connected) continue;
    const q = growthQuote(s, n.id);
    if (q) list.push({ id: n.id, length: q.length, ocean: q.ocean });
  }
  reachCache.set(s, { key, list });
  return list;
}

/** Der Bot spart gerade für den Schleimpilz-Kern (zählt nicht als „tote Phase“, kein Sporenflug). */
let savingForBoss = false;
const UP_ORDER: UpgradeId[] = ['tiefsee', 'planet', 'kristall', 'fern', 'frucht', 'hyphen', 'enzym', 'rhizo'];

function decide(s: GameState): string | null {
  savingForBoss = false;
  // 0. Auf dem Planeten: Tiefsee-Hyphen sofort, sonst kommt man nicht weiter
  if (s.zone >= 4 && s.levels.tiefsee === 0) {
    if (canBuy(s, 'tiefsee')) {
      buy(s, 'tiefsee');
      return 'buy';
    }
  }
  // 1. Wachsen, wenn möglich
  if (!s.growth) {
    const targets = reachableTargets(s);
    // Schleimpilz: ab 115 Knoten gezielt zu seinem Kern vorarbeiten und ihn angreifen
    const b = boss(s);
    let hunt: { x: number; y: number } | null = null;
    if (b?.alive && connectedCount(s) >= 115) {
      const core = s.nodes[b.core]!;
      const t = targets.find((x) => x.id === b.core);
      if (t) {
        const cost = growthCost(s, t.length, core, t.ocean);
        if (s.res.n >= cost) {
          startGrowth(s, t.id);
          return 'grow';
        }
        savingForBoss = true; // dafür sparen – bewusste Entscheidung, keine tote Phase
        return null;
      }
      hunt = core;
    }
    let best = -1;
    let bestScore = 0;
    let bestCost = 0;
    const m = mods(s);
    for (const { id, length, ocean } of targets) {
      const n = s.nodes[id]!;
      if (n.connected) continue;
      const cost = growthCost(s, length, n, ocean, m);
      const q = { cost };
      let sc = targetScore(s, n.id, q.cost);
      // auf der Jagd: Ziele nahe am Schleimpilz-Kern stark bevorzugen (Weg übers Meer zu seinem Kontinent)
      if (hunt) sc *= 1 + 40 * Math.max(0, 1 - Math.hypot(n.x - hunt.x, n.y - hunt.y) / 7000);
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
    for (const id of UP_ORDER) {
      if (canBuy(s, id) && (best < 0 || upgradeCost(s, id).n < bestCost * 0.6)) {
        buy(s, id);
        return 'buy';
      }
    }
  } else {
    for (const id of UP_ORDER) {
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
  /** längste Pause auf dem Planeten (Zone 4) */
  longestGap4: number;
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
  /** Ziel erreicht? (Standard: goal Knoten) */
  done?: (s: GameState) => boolean;
}

/** Spielt einen Durchlauf. Schritt 0,25 s – genau genug und schnell. */
function run(profile: Profile, seed: number, opt: RunOptions = {}): RunResult {
  const s = opt.start ?? newGame(seed);
  const goal = opt.goal ?? CONFIG.zoneGoal;
  const max = opt.maxSeconds ?? MAX_SECONDS;
  // ab Zone 3 reicht ein grober Schritt (dort zählen Minuten, nicht Sekunden) – spart viel Rechenzeit
  const dtFor = (x: GameState) => (x.zone >= 3 ? 1 : 0.25);
  let dt = dtFor(s);
  const milestones: Record<number, number | null> = Object.fromEntries(MILESTONES.map((m) => [m, null]));
  let t = 0;
  let nextCheck = 0;
  let tapAcc = 0;
  let lastAction = 0;
  let longestGap = 0;
  let longestGap4 = 0;
  let lastCount = connectedCount(s);
  let lastNodeAt = 0;
  const done = opt.done ?? ((x: GameState) => connectedCount(x) >= goal);
  while (t < max && !done(s)) {
    if (s.events.golden && profile.checkEvery(t) <= 1) catchGolden(s);
    tapAcc += profile.tapsPerSecond(t) * dt;
    while (tapAcc >= 1) {
      tap(s);
      tapAcc--;
    }
    if (t >= nextCheck) {
      while (decide(s)) {
        if (DEBUG && t - lastAction > 300) {
          const ts = reachableTargets(s);
          const m = mods(s);
          const cheapest = Math.min(...ts.map((x) => growthCost(s, x.length, s.nodes[x.id], x.ocean, m)));
          console.log(`PAUSE ${formatDuration(t - lastAction)} bei ${connectedCount(s)} Knoten Zone ${s.zone}: N ${s.res.n.toExponential(2)} (${computeRates(s).n.toExponential(2)}/s), billigstes Ziel ${cheapest.toExponential(2)}, Ziele ${ts.length}, Zucker ${Math.round(s.res.sugar)}, Min ${Math.round(s.res.minerals)}, ${JSON.stringify(s.levels)}`);
        }
        // auf dem Planeten sind längere Sparphasen gewollt (große Fäden übers Meer) – getrennt messen
        if (s.zone >= 4) longestGap4 = Math.max(longestGap4, t - lastAction);
        else longestGap = Math.max(longestGap, t - lastAction);
        lastAction = t;
      }
      if (savingForBoss) lastAction = t;
      checkAchievements(s);
      nextCheck = t + profile.checkEvery(t);
      if (opt.stopWhen?.(s, t - lastNodeAt)) break;
    }
    tick(s, dt);
    t += dt;
    dt = dtFor(s);
    const c = connectedCount(s);
    if (c > lastCount) {
      lastCount = c;
      lastNodeAt = t;
    }
    for (const m of MILESTONES) if (milestones[m] === null && c >= m) milestones[m] = t;
  }
  return { milestones, longestGap, longestGap4, finalNps: computeRates(s).n, levels: { ...s.levels }, state: s, seconds: t };
}

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
};

let problems = 0;

// ---------- Teil 1: erster Durchlauf, Zone 1 ----------
for (const p of ONLY_OFFLINE || ONLY_CAMPAIGN ? [] : PROFILES) {
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
const GENOME_ORDER = ['p1', 'z1', 's1', 'p2', 'z2', 's2', 'p3', 'z3', 's3', 'p4', 'z4', 's4', 'w1', 'w2', 'w3', 'w4', 'o1', 'o2', 'o3', 'o4'] as const;
/** Planet umspannt: 150 Knoten und Schleimpilz besiegt */
const planetDone = (s: GameState) => s.stats.zone4DoneAt !== null;
/** Ein vernünftiger Spieler fliegt, wenn er 5 Min. keinen Knoten mehr schafft und der Flug sich lohnt. */
const shouldFly = (s: GameState, sinceNode: number) =>
  sinceNode > (savingForBoss ? 3600 : 300) && sporeGain(s) >= Math.max(3, 0.25 * s.meta.sporesTotal) && connectedCount(s) >= CONFIG.prestige.minNodes;

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
  // Zone 4: Ziel = Planet umspannt (150 Knoten + Schleimpilz besiegt)
  { goal: CONFIG.zone4.goal, label: 'Planet umspannt', activeBand: [12 * 3600, 70 * 3600] },
];

for (const p of ONLY_OFFLINE ? [] : QUICK || ONLY_CAMPAIGN ? [PROFILES[0]!] : [PROFILES[0]!, PROFILES[1]!]) {
  console.log(`\n=== Kampagne bis zum Planeten (${CONFIG.zone4.goal} Knoten + Schleimpilz) · ${p.name} – 4 Karten ===`);
  const reached: Record<number, number[]> = Object.fromEntries(TARGETS.map((x) => [x.goal, []]));
  const gaps: number[] = [];
  const gaps4: number[] = [];
  const seedArg = Number(process.argv.find((x) => x.startsWith('--seed='))?.slice(7) ?? 0);
  for (const seed of seedArg ? [seedArg] : SEEDS.slice(0, ONLY_CAMPAIGN ? 1 : QUICK ? 2 : 4)) {
    let state: GameState | undefined;
    let total = 0;
    let runs = 0;
    let worstGap = 0;
    let worstGap4 = 0;
    const firstAt: Record<number, number> = {};
    const lines: string[] = [];
    const maxRuns = Number(process.argv.find((x) => x.startsWith('--runs='))?.slice(7) ?? 80);
    while (runs < maxRuns && total < 100 * 3600) {
      const t0 = performance.now();
      const res = run(p, seed * 1000 + runs, { start: state, done: planetDone, stopWhen: shouldFly, maxSeconds: 10 * 3600 });
      if (ONLY_CAMPAIGN)
        console.log(`  Durchlauf ${runs + 1}: ${formatDuration(res.seconds)} Spielzeit, ${connectedCount(res.state)} Knoten, Zone ${res.state.zone}, +${sporeGain(res.state)} Sp, Rechenzeit ${((performance.now() - t0) / 1000).toFixed(1)} s, längste Pause ${formatDuration(res.longestGap)} / Planet ${formatDuration(res.longestGap4)}`);
      for (const tg of TARGETS) {
        const at = tg.goal === CONFIG.zone4.goal ? res.state.stats.zone4DoneAt : res.milestones[tg.goal];
        if (at !== null && at !== undefined && firstAt[tg.goal] === undefined) firstAt[tg.goal] = total + at;
      }
      total += res.seconds;
      runs++;
      if (runs > 1) worstGap = Math.max(worstGap, res.longestGap);
      worstGap4 = Math.max(worstGap4, res.longestGap4);
      lines.push(`${formatDuration(res.seconds)}/${connectedCount(res.state)}K${boss(res.state)?.alive === false ? '☠' : ''}/+${sporeGain(res.state)}Sp`);
      if (ONLY_CAMPAIGN && res.state.zone >= 4) console.log(`    Stufen: ${JSON.stringify(res.state.levels)} · Sporen ges. ${res.state.meta.sporesTotal} · N/s ${Math.round(computeRates(res.state).n)}`);
      if (planetDone(res.state)) break;
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
    gaps4.push(worstGap4);
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
  console.log(`Längste Pause ab Durchlauf 2, Zone 1–3 (Median): ${formatDuration(median(gaps))}`);
  // seit 1.3 laufen die Durchläufe über 100 Knoten hinaus – das teure Ende von Zone 3 zählt mit, daher 6 statt 5 Min.
  if (p.active && median(gaps) > 360) {
    console.log('  ⚠ Tote Phasen über 6 Minuten in späteren Durchläufen');
    problems++;
  }
  // Planet: Sparen auf große Fäden ist gewollt, aber nicht ewig
  console.log(`Längste Pause auf dem Planeten (Median): ${formatDuration(median(gaps4))}`);
  if (p.active && median(gaps4) > 20 * 60) {
    console.log('  ⚠ Auf dem Planeten über 20 Minuten nichts zu tun');
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
for (const eagerFly of QUICK || ONLY_CAMPAIGN ? [] : [false, true]) {
  console.log(`\n=== Offline-Spieler${eagerFly ? ' (fliegt eifrig)' : ''}: alle ${OFFLINE_GAP / 3600} Std. ${SESSION / 60} Min. reinschauen – ${ONLY_OFFLINE ? 4 : 3} Karten ===`);
  const z2: number[] = [];
  const z3: number[] = [];
  const z4: number[] = [];
  let maxGain = 0;
  for (const seed of SEEDS.slice(0, ONLY_OFFLINE ? 4 : 3)) {
    let state = newGame(seed * 77);
    let real = 0;
    let flights = 0;
    let lastCount = -1;
    const gains: number[] = [];
    let at2: number | undefined;
    let at3: number | undefined;
    let atP: number | undefined;
    while (real < 40 * 86400 && atP === undefined) {
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
      const res = run(offlineProfile, 0, { start: state, done: planetDone, maxSeconds: SESSION });
      state = res.state;
      real += res.seconds;
      const mark = () => {
        if (at2 === undefined && connectedCount(state) >= CONFIG.zone2.goal) at2 = real;
        if (at3 === undefined && connectedCount(state) >= CONFIG.zone3.goal) at3 = real;
        if (atP === undefined && planetDone(state)) atP = real;
      };
      mark();
      if (atP !== undefined) break;
      applyOffline(state, 0, OFFLINE_GAP * 1000);
      real += OFFLINE_GAP;
      mark();
    }
    z2.push(at2 ?? Infinity);
    z3.push(at3 ?? Infinity);
    z4.push(atP ?? Infinity);
    const day = (x?: number) => (x === undefined ? '–' : `${(x / 86400).toFixed(1)} Tage`);
    console.log(`Karte ${seed}: Zone 2 nach ${day(at2)}, Zone 3 nach ${day(at3)}, Planet nach ${day(atP)}, ${flights} Flüge, Sporen je Flug: ${gains.join(', ')}`);
  }
  const md = (xs: number[]) => (Number.isFinite(median(xs)) ? `${(median(xs) / 86400).toFixed(1)} Tage` : 'nicht erreicht');
  console.log(`Zone 2 (Median): ${md(z2)} · Zone 3 (Median): ${md(z3)} · Planet (Median): ${md(z4)} · größter Flug: ${maxGain} Sporen`);
}

console.log(problems ? `\n${problems} Balancing-Problem(e) gefunden.` : '\nKeine Balancing-Probleme gefunden.');
if (problems) process.exit(1);
