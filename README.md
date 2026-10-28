# Myzel

**▶ Jetzt spielen: https://ainzooalgo.github.io/myzel**

Als App installieren: Link im Handy-Browser öffnen → Menü ⋮ → „Zum Startbildschirm hinzufügen“.

Incremental-Spiel über ein wachsendes Pilzgeflecht. Stand: Version 1.1 (Zone 3 „Kontinent“).

| Befehl | Zweck |
| --- | --- |
| `bun test` | Unit-Tests des Spielkerns |
| `tsc --noEmit -p .` | Typprüfung |
| `bun scripts/simulate.ts` | Balancing-Simulation (Bot spielt 3 Spielstile × 8 Karten) |
| `bun scripts/build.ts` | Testversion `dist/index.html` (mit Tempo-Regler) |
| `bun scripts/build.ts --release` | Release in `release/`: installierbare Web-App, offline spielbar, ohne Testwerkzeuge |

Veröffentlichung: Jeder Push auf `main` startet `.github/workflows/pages.yml` – Typprüfung, Tests und Simulation müssen grün sein, dann geht die Release-Version auf GitHub Pages.

Aufbau: `src/core` = reine Spiellogik ohne Grafik (getestet), `src/ui` = Darstellung und Eingabe,
`src/i18n` = alle Texte, `src/core/config.ts` = alle Balancing-Zahlen.
