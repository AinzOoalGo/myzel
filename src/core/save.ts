import { type GenomeId, type UpgradeId } from './config';
import { generateMap } from './map';
import { mods, newMeta, simulate, type Edge, type EventsState, type GameState, type Growth, type Meta } from './game';

/**
 * Spielstände sind versioniert. Bei jeder Formatänderung:
 *  1. SAVE_VERSION erhöhen
 *  2. eine Migration (alte Version → neue) in MIGRATIONS ergänzen
 *  3. einen Test mit einem echten alten Spielstand hinzufügen
 * So gehen alte Spielstände bei Updates nie verloren.
 */
export const SAVE_VERSION = 2;

export interface SaveV2 {
  v: 2;
  savedAt: number; // ms seit Epoche
  seed: number;
  connected: number[];
  edges: [number, number][];
  stocks: Record<string, number>; // nur geänderte Totholz-Vorräte
  res: { n: number; sugar: number; water: number };
  levels: Record<UpgradeId, number>;
  growth: Growth | null;
  stats: GameState['stats'];
  meta: Meta;
  events: EventsState;
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
};

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function serialize(s: GameState, now: number): SaveV2 {
  const fresh = generateMap(s.seed);
  const stocks: Record<string, number> = {};
  for (const n of s.nodes) {
    if (n.type === 'totholz' && n.stock !== fresh[n.id]?.stock) stocks[n.id] = n.stock;
  }
  return {
    v: 2,
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
  };
}

function migrate(raw: AnySave): SaveV2 {
  let cur = raw;
  while (cur.v < SAVE_VERSION) {
    const step = MIGRATIONS[cur.v];
    if (!step) throw new Error(`Keine Migration von Version ${cur.v}`);
    cur = step(cur);
  }
  if (cur.v !== SAVE_VERSION) throw new Error(`Spielstand-Version ${cur.v} ist neuer als dieses Spiel`);
  return cur as unknown as SaveV2;
}

const GENOME_IDS = new Set<GenomeId>(['z1', 'z2', 'z3', 'z4', 's1', 's2', 's3', 's4', 'p1', 'p2', 'p3', 'p4']);

function readMeta(m: Partial<Meta> | undefined): Meta {
  const base = newMeta();
  if (!m) return base;
  const lt: Partial<Meta['lifetime']> = m.lifetime ?? {};
  return {
    spores: num(m.spores),
    sporesTotal: num(m.sporesTotal),
    runs: num(m.runs),
    genome: Array.isArray(m.genome) ? m.genome.filter((g): g is GenomeId => GENOME_IDS.has(g)) : [],
    achievements: Array.isArray(m.achievements) ? m.achievements.filter((a) => typeof a === 'string') : [],
    lifetime: {
      totalN: num(lt.totalN),
      taps: num(lt.taps),
      goldCaught: num(lt.goldCaught),
      rainSeen: num(lt.rainSeen),
      playSeconds: num(lt.playSeconds),
    },
  };
}

export function deserialize(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object' || typeof (raw as AnySave).v !== 'number') throw new Error('Ungültiger Spielstand');
  const d = migrate(raw as AnySave);
  const nodes = generateMap(num(d.seed));
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
  return {
    seed: num(d.seed),
    nodes,
    edges,
    res: { n: num(d.res?.n), sugar: num(d.res?.sugar), water: num(d.res?.water) },
    levels: { hyphen: num(lv.hyphen), enzym: num(lv.enzym), frucht: num(lv.frucht), rhizo: num(lv.rhizo) },
    growth: d.growth ?? null,
    stats: {
      totalN: num(d.stats?.totalN),
      taps: num(d.stats?.taps),
      playSeconds: num(d.stats?.playSeconds),
      zoneDoneAt: d.stats?.zoneDoneAt ?? null,
    },
    meta: readMeta(d.meta),
    events: { active: ev.active ?? null, golden: ev.golden ?? null, nextAt: num(ev.nextAt, 150), counter: num(ev.counter) },
  };
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
