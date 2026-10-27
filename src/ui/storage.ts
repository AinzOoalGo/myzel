/** localStorage kann in manchen Umgebungen fehlen oder werfen – daher alles abgesichert. */
const KEY = 'myzel.save';
const PREFS = 'myzel.prefs';

export function loadRaw(): unknown {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function saveRaw(data: unknown): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nichts zu tun */
  }
}

export interface Prefs {
  vibration: boolean;
  reducedMotion: boolean;
  /** nur Testmodus */
  speed: number;
}

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>;
    return { vibration: p.vibration ?? true, reducedMotion: p.reducedMotion ?? systemReducedMotion(), speed: typeof p.speed === 'number' ? p.speed : 1 };
  } catch {
    return { vibration: true, reducedMotion: systemReducedMotion(), speed: 1 };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* nichts zu tun */
  }
}

function systemReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
