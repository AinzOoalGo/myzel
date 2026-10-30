# Spieldesign – aktueller Stand (Version 1.2.1)

Beschreibt, **wie das Spiel jetzt funktioniert**. Alle Zahlen stehen in `src/core/config.ts` (dort ist die Quelle der Wahrheit – bei Abweichungen gilt der Code). Texte stehen in `src/i18n/de.ts`.

## Vision und Design-Säulen

Ein ruhiges, schönes Idle-Spiel: Ein leuchtendes Pilzgeflecht wächst sichtbar über die Karte. Jede Funktion soll mindestens eine Säule stärken:
1. **Sichtbares Wachstum** – Fortschritt verändert das Bild.
2. **Bedeutsame Entscheidungen** – *wohin* man wächst ist wichtiger als *wie schnell* man tippt.
3. **Respekt vor der Zeit** – kein Grind ohne Fortschritt, keine Zwangswerbung, fairer Offline-Ertrag.

## Kernschleife

1. **Tippen** aufs Spielfeld → Nährstoffe (Basis 1, + Hyphenspitzen, × Mutationen/Boni). Tippen beschleunigt außerdem einen wachsenden Faden.
2. **Knoten antippen** (gestrichelter Ring = erreichbar) → Karte mit Ertrag, Beschreibung und Knopf „Wachsen · Kosten“.
3. **Faden wächst** vom nächsten verbundenen Knoten in Reichweite, nie durch Steine. Immer nur ein Faden gleichzeitig. Kosten = Länge × 0,5 × Kostenanstieg je verbundenem Knoten × Rabatte.
4. **Verbundene Knoten produzieren** automatisch – auch offline (Standard 12 Std., Mutation „Langer Schlaf“ +12 Std. je Stufe).
5. **Upgrades** kaufen → schneller wachsen und mehr produzieren.

Entfernungsbonus: Knoten weiter draußen bringen mehr (Ertrag × (1 + Distanz/350), außerhalb des Waldes gedämpft).

## Ressourcen

| Ressource | Quelle | Wofür |
| --- | --- | --- |
| Nährstoffe (N) | Tippen, Laub, Totholz, Moor, Korallenriff, Fruchtkörper, besiegte Rivalen | Fäden, Upgrades |
| Zucker (Z) | Bäume/Altbäume/Urwald-Riesen, **nur wenn sie Wasser bekommen** | Fruchtkörper, Rhizomorphe, Tiefsee-Hyphen, Planetennetz |
| Wasser | Feuchtstellen, Moore, Korallenriffe; Speicher 100 (Mutation: mehr) | wird von Bäumen und Vulkanen (Kühlung) verbraucht |
| Mineralien (M) | Mineraladern (Zone 3), Vulkane (Zone 4, nur mit Wasser) | Kristallspitzen, Fernsporen, Planetennetz |
| Sporen | Sporenflug, Tagesaufgaben | Genom (Mutationen), je Spore dauerhaft +2 % Nährstoffe |

Kopfzeile zeigt Menge und Rate pro Sekunde; Wasser als Netto-Wert (rot wenn negativ, „voll“ wenn Speicher voll).

## Knotentypen

| Knoten | Zone | Wirkung |
| --- | --- | --- |
| Ursprung (Spore) | 1 | Startpunkt |
| Laubschicht | alle | kleiner, endloser Nährstoffertrag |
| Totholz | alle | viel Ertrag, aber begrenzter Vorrat; danach leer |
| Feuchtstelle | alle | Wasser |
| Baum | alle | Zucker gegen Wasser |
| Stein | alle | Hindernis, nicht besiedelbar |
| Altbaum | 2, 3 | viel Zucker, viel Durst |
| Konkurrenzpilz-Kern | 2, 3 | Gegner; erobern = Gegner besiegt + 5 Min. Produktion als Belohnung |
| Moor | 3 | viel Wasser + etwas Nährstoffe |
| Mineralader | 3 | Mineralien |
| Hexenring | 3, 4 | selten; +25 % Sporen beim nächsten Sporenflug (mit Mutation mehr) |
| Vulkan | 4 | 2,5 Mineralien/s, braucht 0,8 Wasser/s zum Kühlen (ohne Wasser nichts) |
| Urwald-Riese | 4 | Baum: 5 Zucker/s (× Entfernung), Durst 1,6 Wasser/s |
| Korallenriff | 4, **im Meer** | Nährstoffe + etwas Wasser; nur per Tiefsee-Faden erreichbar; Riff-Ketten führen zu jedem Kontinent |
| Riesen-Schleimpilz (Kern) | 4 | Endgegner (gelb), siehe unten |

## Zonen

Die Karte ist ein Kreis mit angehängten Ringen. Sie wird aus einem Seed erzeugt. Außerhalb der eigenen Reichweite liegt Nebel.

| Zone | Öffnet bei | Ziel | Neu |
| --- | --- | --- | --- |
| 1 Waldboden | Start | 25 Knoten | Grundmechanik, erster Baum, Sporenflug ab 15 Knoten |
| 2 Wald | 25 Knoten | 60 Knoten | größere Knoten, mehr Reichweite (+170), doppeltes Wachstumstempo, Altbäume, 3 Konkurrenzpilze, Jahreszeiten |
| 3 Kontinent | 60 Knoten | 100 Knoten | Reichweite +420, Tempo ×2,5, 3 Klimazonen, Moor, Mineraladern, Hexenringe, Sporenwind, 2 stärkere Konkurrenzpilze, flacherer Entfernungsbonus |
| 4 Planet (seit 1.3) | 100 Knoten | 150 Knoten **und** Schleimpilz besiegt | Meer um den Heimatkontinent, 5 weitere Kontinente, Tiefsee-Fäden, Vulkane, Urwald-Riesen, Korallenriffe, Riesen-Schleimpilz, Reichweite +700, Tempo ×2, Kostenanstieg je Knoten nur 1,07, Abspann |

**Zone 4 „Planet“ (Entscheidungen des Chefs 30.10.: teure Tiefsee-Fäden, Endgegner ja, Abspann und danach weiterspielen):**
- Ab Zone 3 sieht man am Kartenrand das Meer, ab Zone 4 den ganzen Planeten mit Weltraum und Sternen.
- **Tiefsee-Fäden:** Jeder Faden, der übers Wasser führt, braucht das Upgrade „Tiefsee-Hyphen“ (Zucker), kostet ×4 (jede weitere Stufe −15 %, Mutation „Salzhyphen“ weniger) und wächst halb so schnell. Ein Weg über Land wird immer bevorzugt. Tiefsee-Fäden leuchten blau.
- **Riesen-Schleimpilz:** ein gelber Gegner auf einem der Kontinente; immer sichtbar. Besetzt alle 75 s (offline 150 s) einen freien Knoten, **kann nicht schwimmen** (bleibt auf seinem Kontinent), greift den Spieler nicht an. Kern angreifen kostet ×10; Sieg = 30 Min. Produktion. Mutation „Schleimbändiger“ macht ihn langsamer.
- **Finale:** 150 Knoten + Schleimpilz besiegt → Abspann (Kamera fährt heraus, Text erscheint nacheinander), danach weiterspielen. Wird auch gezeigt, wenn es offline passiert ist (`meta.finaleSeen`). Zählt als „Planeten umspannt“ in der Statistik.

**Klimazonen (Zone 3, je ein Drittel des Kreises):** Tropen (Ertrag ×1,5, Fäden schneller), Steppe (Totholz ×1,6, halbes Wasser), Taiga (Ertrag ×0,85, keine Dürre).

**Jahreszeiten (ab Zone 2, je 4 Min.):** Frühling (Fäden ×1,3), Sommer (Zucker ×1,5, Wasser ×0,8), Herbst (Laub ×2), Winter (Fäden ×0,7, alles ×0,85).

## Upgrades (Tab „Wachstum“)

| Upgrade | Wirkung je Stufe | Kosten (Start, Faktor je Stufe) | sichtbar ab |
| --- | --- | --- | --- |
| Hyphenspitzen | +1 pro Tipp | 15 N, ×1,3 | Start |
| Zersetzer-Enzyme | +20 % Laub/Totholz | 60 N, ×1,3 | Start |
| Fruchtkörper | +1,5 N/s | 120 N + 4 Z, ×1,22 | erster Baum |
| Rhizomorphe | Fäden −10 % Kosten, +25 % Tempo, +20 Reichweite | 250 N + 10 Z, ×1,3 | erster Baum |
| Kristallspitzen | alle Nährstoffe ×1,25 | 40 M, ×1,55 | erste Mineralader |
| Fernsporen | +120 Reichweite | 25 M, ×1,7 | erste Mineralader |
| Tiefsee-Hyphen | Fäden übers Meer möglich; jede weitere Stufe Tiefsee-Fäden −15 % | 1.500 Z, ×2,5 | Zone 4 |
| Planetennetz | alle Nährstoffe ×1,3 | 3.000 Z + 600 M, ×1,7 | Zone 4 |

## Sporenflug (Prestige) und Genom

- Ab **15 Knoten**. Sporen = ⌊√(Nährstoffe dieses Durchlaufs / 2000) × Hexenring-Bonus⌋.
- Setzt Karte, Ressourcen und Upgrades zurück (neuer Wald, neuer Seed). Bleibt erhalten: Sporen, Genom, Erfolge, Tagesaufgaben, Statistik.
- **Genom:** 5 Äste × 4 Mutationen (Weltenpilz ab Zone 4). Stufe 1 einer Mutation braucht die vorherige im selben Ast. Jede Mutation bis **Stufe 5**; jede Stufe kostet ×5 mehr.

| Ast | Mutationen (Wirkung je Stufe) | Grundkosten |
| --- | --- | --- |
| Zersetzer | Scharfe Enzyme (Laub/Totholz +50 %), Gründliche Zersetzung (Totholz +50 %), Kräftige Spitzen (Tipps +100 %), Allesfresser (Laub +100 %) | 1 / 3 / 6 / 12 |
| Symbiont | Wurzelfreunde (Zucker +50 %), Wasserspeicher (Wasser +50 %, Speicher +200 %), Langer Schlaf (Offline +12 Std.), Waldnetz (+5 % N je Baum) | 1 / 3 / 6 / 12 |
| Pionier | Leichte Fäden (Fäden billiger, abnehmend: −20 % … −56 %), Weitblick (+40 Reichweite), Sprinter (Fäden +100 % Tempo), Startkapital (1.000 N, ×10 je Stufe) | 1 / 3 / 6 / 12 |
| Wanderer | Windreiter (Sporenwind häufiger/länger), Mineralfresser (Mineralien +100 %), Hexenmeister (Hexenringe +100 %), Kontinentalnetz (+1 % N je Knoten) | 15 / 30 / 50 / 80 |
| Weltenpilz (erst nach dem ersten Besuch in Zone 4) | Salzhyphen (Tiefsee-Fäden billiger, abnehmend), Vulkanherz (Vulkane +100 %), Urwaldbund (Urwald-Riesen und Riffe +100 %), Schleimbändiger (Schleimpilz +50 % Wartezeit) | 40 / 80 / 150 / 250 |

## Ereignisse (alle 3–7 Min. Spielzeit)

| Ereignis | Wirkung | Hinweis |
| --- | --- | --- |
| Regen (60 s) | Fäden ×2, Wasser ×3 | Regen-Animation + Geräusch |
| Dürre (90 s) | Wasser ×0,3 (offline nur ×0,65) | nur wenn ein Baum verbunden ist; Taiga immun |
| Goldener Fruchtkörper (12 s) | antippen = 60 s Produktion | erscheint nie offline |
| Sporenwind (40 s, ab Zone 3) | Fäden kosten nur ¼ | Windböen-Animation |

## Konkurrenzpilze

- Zone 2: 3 Rivalen, Zone 3: 2 stärkere, Zone 4: der Riesen-Schleimpilz (siehe Zonen). Sie werden erst aktiv, wenn ihre Zone offen ist, und bleiben in ihrer Zone.
- Alle 2 Min. (offline 4 Min.) besetzt jeder Rivale den nächsten **freien** Knoten in Reichweite. Findet er nichts, wächst seine Reichweite (er bleibt nie stehen).
- **Sie greifen den Spieler nicht an** (bewusste Entscheidung: ruhiges Spielgefühl).
- Spieler: besetzten Knoten **zurückerobern** (×2,5 Kosten) – alles dahinter wird ebenfalls frei („Leitung kappen“); **Kern angreifen** (×4 Kosten) → Rivale besiegt, alle seine Knoten frei, 5 Min. Produktion Belohnung.

## Erfolge und Tagesaufgaben

- **42 Erfolge** (`src/core/achievements.ts`), je dauerhaft +2 % Nährstoffe.
- **Tagesaufgaben** (`src/core/daily.ts`): jeden Kalendertag (Ortszeit) 3 Aufgaben aus einem Pool, passend zur Zone (z. B. „Verbinde 2× Baum“, „Kaufe 30 Upgrades“, „Starte 1 Sporenflug“, „Erobere 2 Knoten zurück“). Belohnung: 2 + 4 % der jemals gewonnenen Sporen. Alle drei abgeholt → Serie +1 und Bonus (+1 je Serientag, max. +7). Verpasster Tag setzt die Serie zurück.

## Statistik

Lokal gespeichert (`src/core/tracking.ts`, Anzeige `src/ui/stats.ts`): echte Zeit mit offener App, davon mit Tempo > ×1, Offline-Zeit, Sitzungen (Pausen < 30 s zählen nicht als neue Sitzung), Verlauf aller Durchläufe (Dauer, Knoten, Zone, Sporen, Zeitpunkte der Zonen). Export als Text zum Einfügen in einen Chat.

## Oberfläche und Gefühl

- Kopfzeile (Ressourcen + Raten, Zonen-Fortschritt, rotes „Test ×N“-Schild bei Tempo-Regler, ⚙).
- Spielfeld: biolumineszenter Stil, geschwungene Fäden mit Seitenhärchen, Dicke nach Fluss, Lichtpulse zum Ursprung (nur wo wirklich etwas fließt), tote Äste schwächer. Zoom (Mausrad/zwei Finger), Verschieben, „⌂ Ursprung“ (ab Zone 2), „⌖ Zentrieren“. Hinweise oben, Jahreszeit unten links.
- Unten: zuklappbare Leiste mit Wachstum · Genom · Erfolge; gelber Punkt = dort ist etwas kaufbar/abholbar.
- Einstellungen: Hilfe, Legende, Vibration, weniger Bewegung, Lautstärke Natur/Effekte, (Tempo-Regler), Statistik, Export/Import, Neues Spiel, Version (7× tippen = Entwicklermodus).
- Ton: Effekte und Naturgeräusche, im Browser erzeugt (keine Audiodateien, keine Lizenzen). Keine Musik.
