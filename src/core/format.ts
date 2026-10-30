const UNITS = ['', 'Tsd.', 'Mio.', 'Mrd.', 'Bio.', 'Brd.', 'Trio.', 'Trd.', 'Quad.'];

const de1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const de2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Kurzschreibweise: 950 · 9,5 · 1,23 Tsd. · 4,50 Mio. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a < 10) return sign + de1.format(Math.floor(a * 10) / 10);
  if (a < 1000) return sign + Math.floor(a).toString();
  const tier = Math.min(UNITS.length - 1, Math.floor(Math.log10(a) / 3));
  const scaled = a / 10 ** (tier * 3);
  return `${sign}${de2.format(Math.floor(scaled * 100) / 100)} ${UNITS[tier]}`;
}

/** Dauer in Worten: 45 Sek. · 3 Min. · 2 Std. 5 Min. */
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s} Sek.`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} Std. ${rm} Min.` : `${h} Std.`;
}

/** Kurzform für die enge Kopfzeile: höchstens 3 gültige Ziffern (5,41 Mio. · 54,1 Mio. · 541 Mio.) */
export function formatShort(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  const a = Math.abs(v);
  if (a < 1000) return formatNumber(v);
  const sign = v < 0 ? '-' : '';
  const tier = Math.min(UNITS.length - 1, Math.floor(Math.log10(a) / 3));
  const scaled = a / 10 ** (tier * 3);
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const f = 10 ** digits;
  const str = new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.floor(scaled * f) / f);
  return `${sign}${str} ${UNITS[tier]}`;
}
