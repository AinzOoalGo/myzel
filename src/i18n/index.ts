import { de, type TextKey } from './de';

const dict: Record<TextKey, string> = de;

/** Text holen und {platzhalter} ersetzen. */
export function t(key: TextKey, vars: Record<string, string | number> = {}): string {
  return dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
