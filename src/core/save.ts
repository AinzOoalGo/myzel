import { CONFIG, type UpgradeId } from './config';
import { generateMap } from './map';
import { simulate, type Edge, type GameState, type Growth } from './game';

/**
 * Spielstände sind versioniert. Bei jeder Formatänderung:
 *  1. SAVE_VERSION erhöhen
 *  2. eine Migration (alte Version → neue) in MIGRATIONS ergänzen
 *  3. einen Test mit einem echten alten Spielstand hinzufügen
 * So gehen alte Spielstände bei Updates nie verloren.
 */
export const SAVE_VERSION = 1;

export interface SaveV1 {
  v: 1;
  savedAt: number; // ms seit Epoche
  seed: number;
  connected: number[];
  edges: [number, number][];
  stocks: Record<string, number>; // nur geänderte Totholz-Vorräte
  res: { n: number; sugar: number; water: number };
  levels: Record<UpgradeId, number>;
  growth: Growth | null;
  stats: GameState['stats'];
}

type AnySave = { v: number } & Record<string, unknown>;
const MIGRATIONS: Record<number, (old: AnySave) => AnySave> = {
  // Beispiel für später: 1: (s) => ({ ...s, v: 2, neuesFeld: 0 }),
};

export function serialize(s: GameState, now: number): SaveV1 {
  const fresh = generateMap(s.seed);
  const stocks: Record<string, number> = {};
  for (const n of s.nodes) {
    if (n.type === 'totholz' && n.stock !== fresh[n.id]?.stock) stocks[n.id] = n.stock;
  }
  return {
    v: 1,
    savedAt: now,
    seed: s.seed,
    connected: s.nodes.filter((n) => n.connected && n.type !== 'spore').map((n) => n.id),
    edges: s.edges.map((e) => [e.from, e.to]),
    stocks,
    res: { ...s.res },
    levels: { ...s.levels },
    growth: s.growth ? { ...s.growth } : null,
    stats: { ...s.stats },
  };
}

function migrate(raw: AnySave): SaveV1 {
  let cur = raw;
  while (cur.v < SAVE_VERSION) {
    const step = MIGRATIONS[cur.v];
    if (!step) throw new Error(`Keine Migration von Version ${cur.v}`);
    cur = step(cur);
  }
  if (cur.v !== SAVE_VERSION) throw new Error(`Spielstand-Version ${cur.v} ist neuer als dieses Spiel`);
  return cur as unknown as SaveV1;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

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
  const seconds = Math.max(0, Math.min(CONFIG.offlineCapSeconds, (now - savedAt) / 1000));
  const before = s.stats.totalN;
  simulate(s, seconds, 1);
  return { seconds, gained: s.stats.totalN - before };
}
