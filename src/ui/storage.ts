/** localStorage kann in manchen Umgebungen fehlen oder werfen – daher alles abgesichert. */
const KEY = 'myzel.save';
const PREFS = 'myzel.prefs';

const BACKUP = 'myzel.save.bak';

function read(key: string): unknown {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Hauptspielstand und die Sicherungskopie (der vorherige Stand). */
export function loadRaw(): unknown {
  return read(KEY);
}
export function loadBackup(): unknown {
  return read(BACKUP);
}

/** Schreibt den neuen Stand; der bisherige wird vorher zur Sicherungskopie. */
export function saveRaw(data: unknown): boolean {
  try {
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(BACKUP, prev);
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(BACKUP);
  } catch {
    /* nichts zu tun */
  }
}

export interface Prefs {
  vibration: boolean;
  reducedMotion: boolean;
  /** nur Testmodus */
  speed: number;
  music: number; // 0..1
  sfx: number; // 0..1
  /** versteckter Entwicklermodus (nur dieses Gerät) */
  devMode: boolean;
  /** Liste unten aufgeklappt? */
  panelOpen: boolean;
}

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? '{}') as Partial<Prefs>;
    return { vibration: p.vibration ?? true, reducedMotion: p.reducedMotion ?? systemReducedMotion(), speed: typeof p.speed === 'number' ? p.speed : 1, music: typeof p.music === 'number' ? p.music : 0.5, sfx: typeof p.sfx === 'number' ? p.sfx : 0.7, devMode: p.devMode === true, panelOpen: p.panelOpen === true };
  } catch {
    return { vibration: true, reducedMotion: systemReducedMotion(), speed: 1, music: 0.5, sfx: 0.7, devMode: false, panelOpen: false };
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
