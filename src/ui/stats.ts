import { connectedCount, type GameState } from '../core/game';
import { formatDuration, formatNumber } from '../core/format';
import { t } from '../i18n';

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
};

/** Kurze Übersicht für die Einstellungen */
export function statsSummary(s: GameState): [string, string][] {
  const tr = s.meta.track;
  const best = Math.max(s.zone, ...tr.history.map((h) => h.zone));
  return [
    [t('st_play'), formatDuration(tr.realActive)],
    [t('st_test'), formatDuration(tr.testReal)],
    [t('st_offline'), formatDuration(tr.offline)],
    [t('st_sessions'), formatNumber(tr.sessions + 1)],
    [t('st_session_avg'), formatDuration(median(tr.sessionLens.length ? tr.sessionLens : [tr.run.realActive]))],
    [t('st_runs'), formatNumber(s.meta.runs)],
    [t('st_run_now'), `${formatDuration(tr.run.realActive)} · ${connectedCount(s)} Knoten · Zone ${s.zone}`],
    [t('st_best'), String(best)],
    [t('st_spores'), formatNumber(s.meta.sporesTotal)],
    [t('st_taps'), formatNumber(s.meta.lifetime.taps)],
  ];
}

const d = (ms: number): string => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '–');
const m = (sec: number | null): string => (sec === null ? '–' : String(Math.round(sec / 60)));

/** Kompakter Text zum Kopieren und Einfügen (für die Auswertung) */
export function statsText(s: GameState, device: string, version: string): string {
  const tr = s.meta.track;
  const lines = [
    `MYZEL-STATISTIK · Gerät: ${device || 'ohne Namen'} · ${version} · ${d(Date.now())} UTC`,
    `Echt: ${Math.round(tr.realActive / 60)} Min (Tempo-Regler: ${Math.round(tr.testReal / 60)} Min) · Offline: ${Math.round(tr.offline / 60)} Min`,
    `Sitzungen: ${tr.sessions + 1} · Median-Sitzung: ${Math.round(median(tr.sessionLens) / 60)} Min · letzte: ${tr.sessionLens.length ? `${tr.sessionLens.slice(-10).map((x) => Math.round(x / 60)).join(',')} Min` : '–'}`,
    `Sporenflüge: ${s.meta.runs} · Sporen gesamt: ${Math.round(s.meta.sporesTotal)} · Mutationen: ${s.meta.genome.length} · Erfolge: ${s.meta.achievements.length} · Tipps: ${s.meta.lifetime.taps} · Serie: ${s.meta.daily.streak}`,
    `Aktuell: Durchlauf ${s.meta.runs + 1}, ${connectedCount(s)} Knoten, Zone ${s.zone}, Spielzeit ${Math.round(s.stats.playSeconds / 60)} Min, echt ${Math.round(tr.run.realActive / 60)} Min, Test ${Math.round(tr.run.testReal / 60)} Min`,
    'Nr | Start | Spiel-Min | Echt-Min | Test-Min | Offline-Min | Knoten | Zone | Sporen | Z1 fertig | Z2 ab | Z2 fertig | Z3 ab | Z3 fertig (Spiel-Min)',
    ...tr.history.map(
      (h) =>
        `${h.n} | ${d(h.startedAt)} | ${m(h.playSec)} | ${m(h.realSec)} | ${m(h.testSec)} | ${m(h.offlineSec)} | ${h.nodes} | ${h.zone} | ${h.spores} | ${m(h.zone1DoneAt)} | ${m(h.zone2At)} | ${m(h.zone2DoneAt)} | ${m(h.zone3At)} | ${m(h.zone3DoneAt)}`,
    ),
  ];
  return lines.join('\n');
}
