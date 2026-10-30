# Architektur

## Grundsätze

- **TypeScript, keine Laufzeit-Abhängigkeiten.** Gebaut mit Bun (`Bun.build`), geprüft mit `tsc`. (Die Arbeitsumgebung konnte keine npm-Pakete laden – daher z. B. Canvas 2D statt PixiJS, eigene Typdeklarationen in `tests/bun-test.d.ts`.)
- **Spiellogik ohne Grafik** (`src/core`) – deterministisch, testbar, vom Simulations-Bot direkt nutzbar.
- **Alle Zahlen in `src/core/config.ts`**, alle Texte in `src/i18n/de.ts` (Englisch später als `en.ts` mit gleichen Schlüsseln).
- Ergebnis ist **eine einzige HTML-Datei** (+ Manifest, Service Worker, Icons im Release).

## Ordner

```
src/
  core/            Spiellogik (keine DOM-Zugriffe)
    config.ts      alle Balancing-Werte, Typen (NodeType, UpgradeId, GenomeId, …); RELEASE-Schalter
    rng.ts         deterministischer Zufall (mulberry32)
    map.ts         Kartenerzeugung: Zone 1 + angehängte Ringe Zone 2/3; Klima
    game.ts        Spielzustand, mods() (alle Multiplikatoren), tick/simulate, Wachstum, Rivalen,
                   Ereignisse, Upgrades, Sporenflug, Genom (Stufen)
    achievements.ts Erfolge (Prüffunktionen)
    daily.ts       Tagesaufgaben (Erzeugung je Datum+Zone, Fortschritt via bump(), Abholen, Serie)
    tracking.ts    Statistik-Datenstrukturen und Zählfunktionen
    save.ts        Speichern/Laden, Versionierung + Migrationen, Offline-Ertrag, Text-Export
    format.ts      Zahlen/Dauer auf Deutsch (1,23 Tsd., 4,50 Mio. …)
  ui/
    render.ts      Canvas-Darstellung, Kamera, Effekte, Leistungs-Optimierungen
    geometry.ts    Fadenpfade (geschwungen, Härchen), Fluss-Berechnung (testbar)
    audio.ts       Web-Audio: Effekte + Waldatmosphäre (prozedural)
    storage.ts     localStorage (mit Sicherungskopie), Einstellungen (prefs)
    stats.ts       Statistik-Anzeige und Export-Text
  i18n/            Texte (de.ts) + t()-Funktion mit {Platzhaltern}
  main.ts          Verdrahtung: DOM, Eingabe, Tabs, Dialoge, Spielschleife, Speichern
  sw.js, manifest.webmanifest   Web-App (nur Release)
index.html         Layout + CSS; Skript wird beim Build eingesetzt
scripts/
  build.ts         Test- bzw. Release-Build
  simulate.ts      Balancing-Bot (siehe BALANCING.md)
  icons.cjs        App-Icons aus assets/icon.svg (einmalig, braucht sharp)
tests/             bun test – Kern, Zonen, Phase 4, Tagesaufgaben, Statistik, Geometrie
```

## Spielschleife

`main.ts → frame()` (requestAnimationFrame, mit Fehlerfang): echte vergangene Zeit × Tempo (Testmodus) wird in festen Schritten von 0,1 s an `tick()` gegeben. War die App > 5 s im Hintergrund, wird die Zeit wie Offline-Zeit nachgeholt. Oberfläche wird alle 0,1 s aktualisiert, Autosave alle 30 s und beim Verlassen.

`tick(s, dt)`: Raten berechnen (`computeRates` mit `mods`) → Totholz abbauen → Ressourcen addieren → Faden wachsen → Ereignisse → Rivalen → Jahreszeiten-Erfolg.

`mods(s)` bündelt **alle** Multiplikatoren (Sporen, Erfolge, Genom-Stufen über `lv()`, Upgrades, Zone, Jahreszeit, Ereignisse). Neue Effekte gehören dort hinein.

## Karte

`generateMap(seed)`: Zone 1 (230 Knoten, Startgruppe garantiert) → `appendZone2` (eigener RNG `seed ^ 0x5a2e2`) → `appendZone3` (eigener RNG `seed ^ 0x3c0717`, Klima-Drehung `seed ^ 0xc11a7e`) → `appendZone4` (Knoten-RNG `seed ^ 0x4a7e70`, Kontinente über `planetGeography(seed)` mit RNG `seed ^ 0x6e0a11`). **Bestehende Zonen dürfen sich nie ändern**, weil Spielstände nur Knoten-IDs speichern. Tests (`tests/zone2.test.ts`, `tests/zone3.test.ts`, `tests/zone4.test.ts`) prüfen Fingerabdrücke der alten Karten. Eine Zone 5 muss genauso angehängt werden.

**Meer (Zone 4):** Land = Heimatkreis (Radius `zone4.coast`) + 5 wellige Kontinente (`Continent`, Randradius mit 3er-/5er-Welle). `isOcean`, `segmentCrossesOcean` (abgetastet alle 120 Einheiten). `findSourceInfo` bevorzugt Landwege; Seewege nur mit Upgrade `tiefsee`. Der Faden merkt sich `growth.ocean` (langsamer). Der Schleimpilz ist ein normaler Rivale mit Kern in Zone 4 (`boss(s)`), darf aber keine Seewege nehmen.

## Spielstände

- Gespeichert in `localStorage['myzel.save']`, vorheriger Stand in `myzel.save.bak` (wird automatisch geladen, wenn der Hauptstand kaputt ist). Einstellungen in `myzel.prefs`.
- Format: kompakt – Seed + verbundene IDs + Kanten + geänderte Totholz-Vorräte + Ressourcen + Stufen + Meta. Karte wird beim Laden aus dem Seed neu erzeugt.
- **`SAVE_VERSION` aktuell 7** (1.3: Zone 4, neue Upgrades, `meta.finaleSeen`, `lifetime.bossBeaten/planets/maxZone`, `stats.zone4DoneAt`). Migrationen 1→2→…→7 in `save.ts`. Alte Spielstände mit ≥ 100 Knoten landen beim Laden direkt in Zone 4. Ein echter v1-Spielstand liegt in `tests/fixtures/save-v1.json` und wird in mehreren Tests geladen.
- **Regel:** Formatänderung ⇒ Version +1, Migration, Test. Neue Felder beim Lesen immer mit sicherem Standardwert (`num()`, `readMeta`, `readTrack`).
- Text-Export = Base64(JSON).

## Darstellung (render.ts)

Canvas 2D in Weltkoordinaten, Kamera = eine Transformation (auto-folgend + Spieler-Zoom/Verschiebung). Wichtige Optimierungen (für große Karten/langsame Handys):
- Hintergrund und Vignette vorberechnet; Sichtbarkeit/Erreichbarkeit nur bei Netzänderung neu berechnet (`refresh`, Cache-Schlüssel).
- Fäden gebündelt nach Dicke als `Path2D`, mit Detailstufen (weniger Punkte beim Herauszoomen); Rivalen-Fäden mit nur einem Strich.
- Kleine Knoten als Punkte; Ringe gesammelt in zwei Pfaden.
- Automatisch niedrigere Qualität, wenn das Gerät länger unter ~38 FPS liegt.

## Build und Veröffentlichung

- `bun scripts/build.ts` → `dist/index.html` (Testversion, `RELEASE=false`, Tempo-Regler sichtbar).
- `bun scripts/build.ts --release` → `release/` mit `index.html`, `sw.js` (Cache mit Versionsnummer, Netz zuerst), Manifest, Icons, `.nojekyll`. `RELEASE=true` → Tempo-Regler nur über Entwicklermodus.
- GitHub Actions `.github/workflows/pages.yml`: bei Push auf `main` → `tsc` → `bun test` → `simulate.ts --quick` → Release-Build → Deploy auf GitHub Pages. Dauer ca. 3–5 Min.

## Qualitätssicherung (vor jedem Push)

1. `tsc --noEmit -p .` und `bun test` grün.
2. Bei Balancing-relevanten Änderungen `bun scripts/simulate.ts` (voll) laufen lassen.
3. Im Browser prüfen (Playwright ist vorinstalliert): Handygrößen 320/360/393 px, Tablet, Desktop; keine Fehler in der Konsole; kein horizontaler Überlauf; bei Bedarf Bildrate mit 4× gedrosselter CPU messen. Testspielstände lassen sich per Skript erzeugen (`newGame` + `serialize`) und über `localStorage` einspielen.
