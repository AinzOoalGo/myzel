# Myzel

**▶ Jetzt spielen: https://ainzooalgo.github.io/myzel**
Als App installieren: Link im Handy-Browser öffnen → Menü ⋮ → „Zum Startbildschirm hinzufügen“.

Myzel ist ein Incremental-/Idle-Spiel (Clicker) für Handy und Browser: Der Spieler lässt ein leuchtendes Pilzgeflecht vom ersten Sporenkorn über den Waldboden und den Wald bis über einen ganzen Kontinent wachsen. Stand: **Version 1.2.1** (Zonen 1–3, Sporenflug, Genom mit Stufen, Tagesaufgaben, Statistik).

## Für eine neue KI-Sitzung / einen neuen Chat

**Lies zuerst [`docs/UEBERGABE.md`](docs/UEBERGABE.md).** Dort steht alles, was man zum Weiterarbeiten braucht: wer was entscheidet, wie wir arbeiten, was gebaut ist, was als Nächstes kommt und welche Regeln gelten. Kurzfassung für Agenten auch in [`CLAUDE.md`](CLAUDE.md).

## Dokumentation

| Datei | Inhalt |
| --- | --- |
| [`docs/UEBERGABE.md`](docs/UEBERGABE.md) | **Einstieg:** Projekt, Rollen, Arbeitsweise, Stand, offene Punkte, Entscheidungen |
| [`docs/SPIELDESIGN.md`](docs/SPIELDESIGN.md) | Alle Spielmechaniken, wie sie *jetzt* im Code umgesetzt sind |
| [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) | Technik: Aufbau des Codes, Datenfluss, Spielstände, Darstellung, Build, Veröffentlichung |
| [`docs/BALANCING.md`](docs/BALANCING.md) | Zielwerte, Simulation, bisherige Messergebnisse und Anpassungen |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Geplante und notierte Ideen in der vom Chef festgelegten Reihenfolge |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Alle Versionen und was sich geändert hat |

## Befehle (Entwicklung)

Benötigt [Bun](https://bun.sh) und TypeScript (`tsc`). Keine weiteren Pakete nötig.

| Befehl | Zweck |
| --- | --- |
| `bun test` | Alle automatischen Tests (aktuell 104) |
| `tsc --noEmit -p .` | Typprüfung |
| `bun scripts/simulate.ts` | Volle Balancing-Simulation (~6–10 Min.) |
| `bun scripts/simulate.ts --quick` | Kurzfassung (~2 Min., läuft auch bei GitHub) |
| `bun scripts/build.ts` | Testversion → `dist/index.html` (Tempo-Regler immer sichtbar) |
| `bun scripts/build.ts --release` | Release → `release/` (Web-App mit Offline-Modus, Tempo-Regler nur über versteckten Entwicklermodus) |

**Veröffentlichung:** Jeder Push auf `main` startet `.github/workflows/pages.yml`: Typprüfung → Tests → Simulation (Kurzfassung) → Release-Build → GitHub Pages. Schlägt ein Schritt fehl, bleibt die alte Version online.
