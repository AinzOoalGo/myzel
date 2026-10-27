# Myzel

Incremental-Spiel über ein wachsendes Pilzgeflecht. Stand: Phase 2 (Graubox-Prototyp).

| Befehl | Zweck |
| --- | --- |
| `bun test` | Unit-Tests des Spielkerns |
| `tsc --noEmit -p .` | Typprüfung |
| `bun scripts/simulate.ts` | Balancing-Simulation (Bot spielt 3 Spielstile × 8 Karten) |
| `bun scripts/build.ts` | Baut `dist/index.html` (eine eigenständige Datei) |

Aufbau: `src/core` = reine Spiellogik ohne Grafik (getestet), `src/ui` = Darstellung und Eingabe,
`src/i18n` = alle Texte, `src/core/config.ts` = alle Balancing-Zahlen.
