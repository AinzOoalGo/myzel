# Übergabe – alles Wichtige zum Weiterarbeiten

Stand: 29.10.2026 · Version 1.2.1 · Repository: https://github.com/AinzOoalGo/myzel · Spiel: https://ainzooalgo.github.io/myzel

## 1. Wer ist wer

- **Der Chef** (Repo-Besitzer, GitHub `AinzOoalGo`): entscheidet *was* gebaut wird und gibt jede Phase frei. Hat **keine Programmier- und keine KI-Kenntnisse**. Schreibt Deutsch (oft schnell und mit Tippfehlern), nutzt vor allem das **Handy** (Android, Brave-Browser, GitHub-App).
- **Die KI (Claude)** ist **Projektleiter und Entwickler**: schlägt vor, plant, baut, testet, veröffentlicht und erklärt verständlich – ohne Fachjargon.

## 2. Wie wir zusammenarbeiten (wichtig!)

1. **Sprache:** Immer Deutsch, einfach und klar. Fachbegriffe vermeiden oder kurz erklären.
2. **Erst fragen, dann bauen bei großen Dingen:** Bei größeren oder mehrdeutigen Änderungen kurz Optionen vorschlagen (mit Empfehlung) und den Chef entscheiden lassen. Kleine, klare Wünsche direkt umsetzen.
3. **Nichts ungefragt umbauen:** Der Chef hat ausdrücklich gesagt: „Ich will noch keine Änderung“ → dann wirklich nichts ändern, nur notieren (siehe ROADMAP).
4. **Ehrlich sein:** Probleme, Grenzen und Abweichungen offen sagen (z. B. Balancing-Kompromisse, Dinge die nicht gehen).
5. **Jede Änderung prüfen, bevor sie online geht:** Typprüfung, Tests, Simulation, im Browser auf Handygröße ansehen (Playwright-Screenshots). Bei neuen Spielmechaniken Tests ergänzen.
6. **Spielstände dürfen nie kaputtgehen:** Format-Änderung ⇒ `SAVE_VERSION` erhöhen + Migration + Test (siehe ARCHITEKTUR).
7. **Die Karte von Zone 1–3 darf sich nie ändern** (Spielstände speichern nur Knoten-IDs). Neue Zonen werden *angehängt*, mit eigenem Zufallsgenerator. Tests mit Fingerabdrücken sichern das ab.
8. **Nach jeder Änderung:** Version erhöhen (`package.json` und `version` in `src/i18n/de.ts`), committen, pushen → GitHub veröffentlicht automatisch. Dem Chef sagen: „App einmal ganz schließen und neu öffnen“, damit das Update geladen wird.
9. **Antworten** kurz halten, mit Ergebnis zuerst, Screenshots schicken wenn es ums Aussehen geht.

## 3. Geräte und Testen

- Der Chef hat **zwei Handys**: eines zum **Testen** (mit Tempo-Regler), eines zum **normalen Spielen**. Ein Kumpel testet ebenfalls.
- **Tempo-Regler (×1/×2/×5/×10):** In der veröffentlichten Version versteckt. Freischalten: ⚙ → ganz unten **7× schnell auf die Versionsnummer tippen** („Entwicklermodus“, nur auf diesem Gerät). Gleicher Trick schaltet ihn wieder aus.
- **Statistik:** ⚙ → Statistik. Gerätename eintragen („Normal“/„Test“). „Statistik kopieren“ erzeugt einen Text, den der Chef in den Chat einfügen kann. Zeit mit Tempo > ×1 wird getrennt gezählt. Daten bleiben nur auf dem Handy (kein Server). Zweck: echtes Spieltempo mit der Simulation vergleichen.
- Es gab außerdem eine **Testversion als claude.ai-Artefakt** (Link aus dem ersten Chat). Sie ist für eine neue Sitzung evtl. nicht zugänglich und **nicht** nötig – maßgeblich ist GitHub Pages.

## 4. Was es gibt (Kurzüberblick, Details in SPIELDESIGN.md)

- **Kern:** Tippen → Nährstoffe; Knoten antippen → Faden wachsen lassen (kostet Nährstoffe, braucht Zeit); verbundene Knoten produzieren automatisch, auch offline (12 Std., mit Mutation mehr).
- **Ressourcen:** Nährstoffe, Zucker (Bäume), Wasser (Feuchtstellen/Moore), Mineralien (Zone 3), Sporen (Prestige).
- **Zonen:** 1 Waldboden (Ziel 25 Knoten) → 2 Wald (ab 25, Ziel 60, Konkurrenzpilze, Jahreszeiten) → 3 Kontinent (ab 60, Ziel 100, Klimazonen, Moor, Mineraladern, Hexenringe, Sporenwind) → 4 Planet (ab 100, Ziel 150 + Riesen-Schleimpilz besiegt; Meer mit Tiefsee-Fäden, Vulkane, Urwald-Riesen, Korallenriffe, Abspann).
- **Prestige „Sporenflug“** ab 15 Knoten → Sporen (über 150 pro Flug gedämpft) → **Genom** mit 5 Ästen × 4 Mutationen (5. Ast „Weltenpilz“ ab Zone 4), jede bis **Stufe 5**.
- **Ereignisse:** Regen, Dürre, goldener Fruchtkörper, Sporenwind (Zone 3).
- **Konkurrenzpilze** (violett) nehmen nur *freie* Knoten, greifen den Spieler **nicht** an. Spieler kann zurückerobern, Leitungen kappen, Kerne angreifen.
- **Erfolge** (42, je +2 % Nährstoffe), **Tagesaufgaben** (3 pro Tag, Sporen, Serienbonus), **Statistik**.
- **Oberfläche:** Kopfzeile mit Ressourcen und Raten; Spielfeld mit Zoom (zwei Finger/Mausrad), Verschieben, Knöpfe „⌂ Ursprung“ und „⌖ Zentrieren“; unten aufklappbare Leiste (Wachstum · Genom · Erfolge). Knoten-Karte: Name + Kosten-Knopf, darunter Ertrag und Beschreibung.
- **Ton:** Selbst erzeugte Effekte + Waldgeräusche (keine Musik – der Chef mochte die Musik nicht).
- **Web-App:** installierbar, offline spielbar, Sicherungskopie des Spielstands, Export/Import als Text.

## 5. Getroffene Entscheidungen des Chefs (nicht ohne Rückfrage ändern)

| Thema | Entscheidung |
| --- | --- |
| Konzept | „Myzel“ (Pilzgeflecht) – ausgewählt aus 4 Ideen |
| Plattform | Browserspiel / Web-App, **später evtl. Play Store** |
| Sprache | Deutsch, **Englisch später** |
| Ton | Ruhig im Kern, Gegner als gelegentliche Herausforderung |
| Name | „Myzel“ – vielleicht später ändern |
| Monetarisierung | **Noch offen** („später schauen“) |
| Umfang 1.0 | Zone 1 + 2 (inzwischen Zone 3 ergänzt) |
| Musik | Keine Musik, stattdessen Naturgeräusche |
| Layout | „Schlanke Liste“ (Variante B), Leiste unten **zuklappbar**, Knoten-Karte mit Infos |
| Gegner | Greifen **nicht** an. Chef findet sie aktuell **evtl. zu schnell** – **noch nicht ändern**, erst Daten aus normalem Spielen (×1) abwarten |
| Reihenfolge | Tagesaufgaben + Genom-Stufen (erledigt) → Zone 4 „Planet“ (erledigt, 1.3) → **Nächstes legt der Chef fest** |
| Zone 4 (30.10.) | Ozeane nur mit **teuren Tiefsee-Fäden**; **Riesen-Schleimpilz** als Endgegner (greift nicht an); bei 150 Knoten + Sieg **Abspann, danach weiterspielen** |
| Battle-Modus | Idee des Chefs (PvP, 4 Spieler, Letzter gewinnt). **Erst wenn der Chef es sagt.** Empfohlen: zuerst Arena gegen 3 Computer-Pilze (ohne Server), dann online |
| Sporen-Schneeball | Chef überließ die Entscheidung dem Projektleiter (30.10.): Dämpfung ab 150 Sporen pro Flug eingebaut (1.2.3), Sporenbonus +2 % unverändert. Weiter beobachten mit Statistik vom „Normal“-Handy |

## 6. Was als Nächstes kommt

Siehe [ROADMAP.md](ROADMAP.md). Kurz: Zone 4 ist fertig (1.3). Was als Nächstes kommt, entscheidet der Chef. Statistik vom „Normal“-Handy weiter auswerten.

## 7. Technik in einem Satz

TypeScript ohne Fremdpakete, Spiellogik (`src/core`) strikt getrennt von Darstellung (`src/ui`, Canvas 2D), alle Zahlen in `src/core/config.ts`, Texte in `src/i18n/de.ts`, Tests mit `bun test`, Balancing-Bot in `scripts/simulate.ts`, Build zu **einer** HTML-Datei, Veröffentlichung über GitHub Actions → GitHub Pages. Details: [ARCHITEKTUR.md](ARCHITEKTUR.md).

## 8. Zugänge

- GitHub: Der Chef hat sein Konto mit Claude verbunden und die **Claude GitHub App** für `AinzOoalGo/myzel` installiert. Pushen funktioniert darüber. Einstellungen wie „Pages aktivieren“ muss der Chef selbst im Browser machen (Repo → Settings → Pages → Source: GitHub Actions – ist bereits erledigt).
- Ursprüngliches Game-Design-Dokument (Konzeptphase) liegt als claude.ai-Dokument vor; der **aktuelle** Stand ist in `docs/SPIELDESIGN.md` beschrieben und hat Vorrang.
