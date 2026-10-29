# Hinweise für KI-Agenten (Claude u. a.)

**Zuerst `docs/UEBERGABE.md` lesen.** Kurzfassung:

- Du bist **Projektleiter + Entwickler**, der Repo-Besitzer ist **„der Chef“**: keine Programmier-/KI-Kenntnisse, schreibt Deutsch vom Handy. Antworte **auf Deutsch, einfach, ohne Fachjargon**, Ergebnis zuerst.
- Größere/mehrdeutige Änderungen: Optionen + Empfehlung vorschlagen, Chef entscheidet. Sagt der Chef „noch nicht ändern“, nur notieren (`docs/ROADMAP.md`).
- Nächster geplanter Schritt: **Zone 4 „Planet“** – erst auf Startsignal.

## Regeln im Code

- Spiellogik nur in `src/core` (kein DOM). Zahlen nur in `src/core/config.ts`, Texte nur in `src/i18n/de.ts`.
- Alle Multiplikatoren über `mods()` in `src/core/game.ts`; Genom-Stufen über `lv()`.
- **Karte von Zone 1–3 nie verändern** – neue Zonen anhängen mit eigenem RNG; Fingerabdruck-Tests müssen grün bleiben.
- **Spielstand-Format ändern ⇒ `SAVE_VERSION` +1, Migration in `src/core/save.ts`, Test.** Neue Felder immer mit Standardwert lesen.
- Version erhöhen in `package.json` **und** `version` in `src/i18n/de.ts`.

## Vor jedem Push

```
tsc --noEmit -p .
bun test
bun scripts/simulate.ts          # bei Balancing-Änderungen (voll, ~6–10 Min.)
bun scripts/build.ts             # Testversion → dist/index.html, im Browser (Playwright) auf 320–393 px prüfen
```

Push auf `main` ⇒ GitHub Actions prüft und veröffentlicht auf https://ainzooalgo.github.io/myzel. Danach dem Chef sagen: App ganz schließen und neu öffnen.

Commit-Autor: `git -c user.name="Myzel" -c user.email="noreply@anthropic.com" commit …`
