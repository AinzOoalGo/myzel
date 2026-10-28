import { type GenomeId, type UpgradeId } from './config';
import { generateMap } from './map';
import { connectedCount, mods, newGame, newMeta, simulate, type Edge, type EventsState, type GameState, type Growth, type Meta, type Rival } from './game';
import { CONFIG, type Zone } from './config';
import type { Daily } from './daily';

/**
 * Spielstände sind versioniert. Bei jeder Formatänderung:
 *  1. SAVE_VERSION erhöhen
 *  2. eine Migration (alte Version → neue) in MIGRATIONS ergänzen
 *  3. einen Test mit einem echten alten Spielstand hinzufügen
 * So gehen alte Spielstände bei Updates nie verloren.
 */
export const SAVE_VERSION = 5;

export interface SaveV5 {
  v: 5;
  savedAt: number; // ms seit Epoche
  seed: number;
  connected: number[];
  edges: [number, number][];
  stocks: Record<string, number>; // nur geänderte Totholz-Vorräte
  res: { n: number; sugar: number; water: number; minerals?: number };
  levels: Record<UpgradeId, number>;
  growth: Growth | null;
  stats: GameState['stats'];
  meta: Meta;
  events: EventsState;
  zone: Zone;
  zone2Since: number | null;
  /** Knoten-ID → Rivale (nur besetzte) */
  owners: Record<string, number>;
  rivals: { edges: [number, number][]; nextAt: number; alive: boolean; reach?: number }[];
}

type AnySave = { v: number } & Record<string, unknown>;
const MIGRATIONS: Record<number, (old: AnySave) => AnySave> = {
  // v1 → v2: Sporenflug, Genom, Erfolge und Ereignisse kamen dazu
  1: (s) => {
    const stats = (s.stats ?? {}) as Partial<GameState['stats']>;
    const meta = newMeta();
    meta.lifetime.totalN = num(stats.totalN);
    meta.lifetime.taps = num(stats.taps);
    meta.lifetime.playSeconds = num(stats.playSeconds);
    return { ...s, v: 2, meta, events: { active: null, golden: null, nextAt: num(stats.playSeconds) + 150, counter: 0 } };
  },
  // v2 → v3: Zone 2, Konkurrenzpilze, Jahreszeiten. Wer schon 25 Knoten hat, landet direkt in Zone 2.
  2: (s) => {
    const connected = Array.isArray(s.connected) ? s.connected.length : 0;
    const stats = (s.stats ?? {}) as Partial<GameState['stats']>;
    const z2 = connected >= CONFIG.zone2.unlockAt;
    return { ...s, v: 3, zone: z2 ? 2 : 1, zone2Since: z2 ? num(stats.playSeconds) : null, owners: {}, rivals: [] };
  },
  // v3 → v4: Zone 3, Mineralien, neue Upgrades. Neue Felder haben beim Lesen sichere Standardwerte.
  3: (s) => ({ ...s, v: 4 }),
  // v4 → v5: Genom-Stufen und tägliche Aufgaben (beide mit sicheren Standardwerten beim Lesen)
  4: (s) => ({ ...s, v: 5 }),
};

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function serialize(s: GameState, now: number): SaveV5 {
  const fresh = generateMap(s.seed);
  const stocks: Record<string, number> = {};
  for (const n of s.nodes) {
    if (n.type === 'totholz' && n.stock !== fresh[n.id]?.stock) stocks[n.id] = n.stock;
  }
  return {
    v: 5,
    savedAt: now,
    seed: s.seed,
    connected: s.nodes.filter((n) => n.connected && n.type !== 'spore').map((n) => n.id),
    edges: s.edges.map((e) => [e.from, e.to]),
    stocks,
    res: { ...s.res },
    levels: { ...s.levels },
    growth: s.growth ? { ...s.growth } : null,
    stats: { ...s.stats },
    meta: structuredClone(s.meta),
    events: structuredClone(s.events),
    zone: s.zone,
    zone2Since: s.zone2Since,
    owners: Object.fromEntries(s.nodes.filter((n) => n.owner > 0 && n.type !== 'rivale').map((n) => [n.id, n.owner])),
    rivals: s.rivals.map((r) => ({ edges: r.edges.map((e) => [e.from, e.to] as [number, number]), nextAt: r.nextAt, alive: r.alive, reach: r.reach })),
  };
}

function migrate(raw: AnySave): SaveV5 {
  let cur = raw;
  while (cur.v < SAVE_VERSION) {
    const step = MIGRATIONS[cur.v];
    if (!step) throw new Error(`Keine Migration von Version ${cur.v}`);
    cur = step(cur);
  }
  if (cur.v !== SAVE_VERSION) throw new Error(`Spielstand-Version ${cur.v} ist neuer als dieses Spiel`);
  return cur as unknown as SaveV5;
}

const GENOME_IDS = new Set<GenomeId>(CONFIG.genome.map((g) => g.id));

function readMeta(m: Partial<Meta> | undefined): Meta {
  const base = newMeta();
  if (!m) return base;
  const lt: Partial<Meta['lifetime']> = m.lifetime ?? {};
  const d = (m.daily ?? {}) as Partial<Daily>;
  const daily: Daily = {
    day: typeof d.day === 'string' ? d.day : '',
    quests: Array.isArray(d.quests)
      ? d.quests
          .filter((q) => q && typeof q.kind === 'string')
          .map((q) => ({ kind: q.kind, nodeType: q.nodeType, target: num(q.target, 1), progress: num(q.progress), claimed: q.claimed === true }))
      : [],
    streak: num(d.streak),
    lastCompleteDay: typeof d.lastCompleteDay === 'string' ? d.lastCompleteDay : null,
  };
  return {
    daily,
    spores: num(m.spores),
    sporesTotal: num(m.sporesTotal),
    runs: num(m.runs),
    genome: Array.isArray(m.genome) ? m.genome.filter((g): g is GenomeId => GENOME_IDS.has(g)) : [],
    genomeLevels: Object.fromEntries(
      Object.entries(m.genomeLevels ?? {})
        .filter(([k, v]) => GENOME_IDS.has(k as GenomeId) && typeof v === 'number')
        .map(([k, v]) => [k, Math.max(1, Math.min(CONFIG.genomeMaxLevel, Math.floor(v as number)))]),
    ),
    achievements: Array.isArray(m.achievements) ? m.achievements.filter((a) => typeof a === 'string') : [],
    lifetime: {
      totalN: num(lt.totalN),
      taps: num(lt.taps),
      goldCaught: num(lt.goldCaught),
      rainSeen: num(lt.rainSeen),
      playSeconds: num(lt.playSeconds),
      seasons: num(lt.seasons),
      rivalsBeaten: num(lt.rivalsBeaten),
      minerals: num(lt.minerals),
      windSeen: num(lt.windSeen),
    },
  };
}

export function deserialize(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object' || typeof (raw as AnySave).v !== 'number') throw new Error('Ungültiger Spielstand');
  const d = migrate(raw as AnySave);
  // Grundgerüst inkl. Rivalen aus der Karte, dann den gespeicherten Zustand darüberlegen
  const base = newGame(num(d.seed), newMeta());
  const nodes = base.nodes;
  for (const id of d.connected ?? []) {
    const n = nodes[id];
    if (n) n.connected = true;
  }
  for (const [id, stock] of Object.entries(d.stocks ?? {})) {
    const n = nodes[Number(id)];
    if (n) n.stock = num(stock);
  }
  const edges: Edge[] = (d.edges ?? []).map(([from, to]) => ({ from, to }));
  const lv = d.levels ?? ({} as Record<UpgradeId, number>);
  const ev = d.events ?? ({} as Partial<EventsState>);
  const rivals: Rival[] = base.rivals.map((r, i) => {
    const saved = d.rivals?.[i];
    if (!saved) return r;
    return {
      core: r.core,
      edges: (saved.edges ?? []).map(([from, to]) => ({ from, to })),
      nextAt: num(saved.nextAt),
      alive: saved.alive !== false,
      reach: num(saved.reach, CONFIG.rivals.reach),
    };
  });
  for (const [id, owner] of Object.entries(d.owners ?? {})) {
    const n = nodes[Number(id)];
    if (n && !n.connected && rivals[num(owner) - 1]) n.owner = num(owner);
  }
  rivals.forEach((r, i) => {
    const core = nodes[r.core];
    if (core) core.owner = r.alive ? i + 1 : 0;
  });
  const zone: Zone = d.zone === 3 ? 3 : d.zone === 2 ? 2 : 1;
  const state: GameState = {
    seed: num(d.seed),
    nodes,
    edges,
    res: { n: num(d.res?.n), sugar: num(d.res?.sugar), water: num(d.res?.water), minerals: num(d.res?.minerals) },
    levels: {
      hyphen: num(lv.hyphen),
      enzym: num(lv.enzym),
      frucht: num(lv.frucht),
      rhizo: num(lv.rhizo),
      kristall: num(lv.kristall),
      fern: num(lv.fern),
    },
    growth: d.growth ?? null,
    stats: {
      totalN: num(d.stats?.totalN),
      taps: num(d.stats?.taps),
      playSeconds: num(d.stats?.playSeconds),
      zoneDoneAt: d.stats?.zoneDoneAt ?? null,
      zone2DoneAt: d.stats?.zone2DoneAt ?? null,
      zone3DoneAt: d.stats?.zone3DoneAt ?? null,
    },
    meta: readMeta(d.meta),
    events: { active: ev.active ?? null, golden: ev.golden ?? null, nextAt: num(ev.nextAt, 150), counter: num(ev.counter) },
    zone,
    zone2Since: zone >= 2 ? num(d.zone2Since, num(d.stats?.playSeconds)) : null,
    rivals,
  };
  // Sicherheitsnetz: Zone 2 freischalten, falls die Bedingung erfüllt ist
  const c = connectedCount(state);
  if (state.zone < 2 && c >= CONFIG.zone2.unlockAt) {
    state.zone = 2;
    state.zone2Since = state.stats.playSeconds;
  }
  if (state.zone === 2 && c >= CONFIG.zone3.unlockAt) state.zone = 3;
  return state;
}

/** Text-Export (Base64 von JSON), damit Spieler ihren Stand sichern können. */
export function exportString(s: GameState, now: number): string {
  const json = JSON.stringify(serialize(s, now));
  return btoa(unescape(encodeURIComponent(json)));
}

export function importString(text: string): { state: GameState; savedAt: number } {
  const json = decodeURIComponent(escape(atob(text.trim())));
  const raw = JSON.parse(json) as { savedAt?: unknown };
  return { state: deserialize(raw), savedAt: num(raw.savedAt, Date.now()) };
}

/** Holt die Abwesenheitszeit nach. Gibt die angerechneten Sekunden und den Nährstoffgewinn zurück. */
export function applyOffline(s: GameState, savedAt: number, now: number): { seconds: number; gained: number } {
  const seconds = Math.max(0, Math.min(mods(s).offlineCap, (now - savedAt) / 1000));
  const before = s.stats.totalN;
  simulate(s, seconds, 1, true);
  return { seconds, gained: s.stats.totalN - before };
}
