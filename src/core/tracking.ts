/**
 * Spielstatistik – nur lokal auf dem Gerät gespeichert, nichts wird versendet.
 * Der Spieler kann sie in den Einstellungen als Text kopieren und weitergeben.
 *
 * Unterschieden wird:
 *  - Spielzeit im Spiel (playSeconds, durch den Tempo-Regler beschleunigt)
 *  - echte Zeit mit offener App (realActive) – davon mit Tempo > ×1 (testReal)
 *  - Offline-Zeit (App zu, Netz arbeitet weiter)
 */

export interface RunRecord {
  n: number; // Nummer des Durchlaufs
  startedAt: number; // ms seit Epoche
  endedAt: number;
  playSec: number;
  realSec: number;
  testSec: number;
  offlineSec: number;
  nodes: number;
  zone: number;
  spores: number; // Sporen aus diesem Sporenflug
  zone1DoneAt: number | null; // Spielsekunden
  zone2At: number | null;
  zone2DoneAt: number | null;
  zone3At: number | null;
  zone3DoneAt: number | null;
}

export interface RunTrack {
  startedAt: number;
  realActive: number;
  testReal: number;
  offline: number;
  zone3At: number | null;
}

export interface Track {
  sessions: number;
  realActive: number;
  testReal: number;
  offline: number;
  /** Länge der letzten Sitzungen in Sekunden (höchstens 50) */
  sessionLens: number[];
  run: RunTrack;
  history: RunRecord[];
}

export const MAX_HISTORY = 100;
export const MAX_SESSIONS = 50;

export function newRunTrack(now: number): RunTrack {
  return { startedAt: now, realActive: 0, testReal: 0, offline: 0, zone3At: null };
}

export function newTrack(now = 0): Track {
  return { sessions: 0, realActive: 0, testReal: 0, offline: 0, sessionLens: [], run: newRunTrack(now), history: [] };
}

/** echte Sekunden mit offener App; speed > 1 zählt zusätzlich als Testzeit */
export function trackActive(t: Track, seconds: number, speed: number): void {
  t.realActive += seconds;
  t.run.realActive += seconds;
  if (speed > 1) {
    t.testReal += seconds;
    t.run.testReal += seconds;
  }
}

export function trackOffline(t: Track, seconds: number): void {
  t.offline += seconds;
  t.run.offline += seconds;
}

export function trackSession(t: Track, lengthSeconds: number): void {
  t.sessions++;
  if (lengthSeconds > 0) {
    t.sessionLens.push(Math.round(lengthSeconds));
    if (t.sessionLens.length > MAX_SESSIONS) t.sessionLens.shift();
  }
}

const num = (v: unknown, f = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : f);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function readTrack(raw: unknown): Track {
  const r = (raw ?? {}) as Partial<Track>;
  const run = (r.run ?? {}) as Partial<RunTrack>;
  return {
    sessions: num(r.sessions),
    realActive: num(r.realActive),
    testReal: num(r.testReal),
    offline: num(r.offline),
    sessionLens: Array.isArray(r.sessionLens) ? r.sessionLens.filter((x) => typeof x === 'number').slice(-MAX_SESSIONS) : [],
    run: {
      startedAt: num(run.startedAt),
      realActive: num(run.realActive),
      testReal: num(run.testReal),
      offline: num(run.offline),
      zone3At: numOrNull(run.zone3At),
    },
    history: Array.isArray(r.history)
      ? r.history.slice(-MAX_HISTORY).map((h) => ({
          n: num(h.n),
          startedAt: num(h.startedAt),
          endedAt: num(h.endedAt),
          playSec: num(h.playSec),
          realSec: num(h.realSec),
          testSec: num(h.testSec),
          offlineSec: num(h.offlineSec),
          nodes: num(h.nodes),
          zone: num(h.zone, 1),
          spores: num(h.spores),
          zone1DoneAt: numOrNull(h.zone1DoneAt),
          zone2At: numOrNull(h.zone2At),
          zone2DoneAt: numOrNull(h.zone2DoneAt),
          zone3At: numOrNull(h.zone3At),
          zone3DoneAt: numOrNull(h.zone3DoneAt),
        }))
      : [],
  };
}
