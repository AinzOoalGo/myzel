# Balancing

## Werkzeug: `scripts/simulate.ts`

Ein Bot spielt den echten Spielkern (ohne Grafik, Schritt 0,25 s):

- **Teil 1 – Zone 1, drei Spielstile × 8 Karten:** „Aktiv“ (5 Tipps/s, entscheidet jede Sekunde), „Gelegentlich“ (2 Tipps/s, schaut alle 20 s), „Idle“ (3 Min. tippen, dann alle 5 Min. reinschauen). Misst Zeit bis 1/5/10/…/25 Knoten und die längste Pause ohne sinnvolle Aktion.
- **Teil 2 – Kampagne bis 100 Knoten** (Aktiv + Gelegentlich, 4 Karten): spielt Durchläufe mit Sporenflug (fliegt, wenn 5 Min. kein neuer Knoten kam und der Flug sich lohnt), kauft danach Mutationen (erst alle freischalten, dann immer die günstigste nächste Stufe).
- Der Bot bewertet Ziele nach „neuer Ertrag pro Kosten“ und kauft Upgrades, wenn sie deutlich billiger sind als das nächste Wachstum.
- **Teil 3 – Offline-Spieler** (seit 1.2.3, wie das „Normal“-Handy): alle 6 Std. 3 Min. reinschauen, dazwischen Offline-Ertrag. Zwei Varianten: fliegt nur, wenn er feststeckt, oder „eifrig“ (sobald sich die Sporen verdoppeln, wie auf dem Test-Handy). Gemessen in echten Tagen; ohne Grenzwert-Prüfung. `--offline` startet nur diesen Teil.
- `--quick`: weniger Karten, nur „Aktiv“ in der Kampagne (für GitHub Actions).

## Zielwerte (Prüfungen im Skript – bei Verletzung Exit-Code 1)

| Prüfung | Ziel |
| --- | --- |
| Zone 1 (25 Knoten), aktiver Spieler, 1. Durchlauf | 10–45 Min. |
| Längste Pause, aktiver Spieler, Zone 1 | ≤ 3 Min. |
| Zone 2 geschafft (60 Knoten), Dauertipper, inkl. Sporenflüge | 2–12 Std. reine Spielzeit |
| Zone 3 geschafft (100 Knoten), Dauertipper | 6–40 Std. (vor 1.2: 8–40) |
| Längste Pause ab Durchlauf 2, aktiv | ≤ 5 Min. |

Der „Dauertipper“ (5 Tipps/s ohne Pause) ist die **obere Grenze**; maßgeblich für das Gefühl ist der normale Spieler („Gelegentlich“).

## Letzte Messung (Version 1.2.3)

| | Dauertipper | Gelegentlich |
| --- | --- | --- |
| Zone 1 geschafft (1. Durchlauf) | ~14 Min. | ~29 Min. |
| Zone 2 geschafft | ~2,5 Std. | ~5,4 Std. |
| Zone 3 geschafft | ~8,8 Std. | ~13,6 Std. |
| Offline-Spieler (alle 6 Std. 3 Min.) | Zone 2 ~3 Tage | Zone 3 ~5,5–10 Tage |
| Durchläufe bis Zone 3 | ~12–14 | ~16–18 |

## Verlauf der wichtigsten Anpassungen

- **0.2:** Kostenanstieg je Knoten 1,09 → 1,28, Wachstum langsamer, Upgrades steiler – Zone 1 dauerte vorher nur 2 Min.
- **1.0.2:** Rivalen blieben nach wenigen Knoten stecken → wachsende Reichweite; dafür Intervall 75 → 120 s.
- **1.1 (Zone 3):** erster Entwurf war in 2 Min. durch → Kostenanstieg Zone 3 1,06 → 1,14, Sporenwind „kostenlos“ → „¼ Kosten“, Entfernungsbonus außerhalb des Waldes gedämpft.
- **1.2.3 (Sporen-Schneeball):** Test-Handy (×10) hatte 6.880 Sporen, einzelne Flüge über 2.000. Offline-Simulation bestätigte: „eifriger“ Spieler bekam bis zu 14.154 Sporen in einem Flug. Lösung: Dämpfung ab 150 Sporen pro Flug (`softCap`, darüber Wurzel). Danach größter Flug ~600, Zeiten bis Zone 3 fast unverändert (aktiv 7,5 → 8,8 Std., offline ~5,5–10 Tage). Sporenbonus +2 % bewusst nicht geändert.
- **1.2 (Genom-Stufen):** machte das Spiel ~2× schneller → Stufenpreis ×2,5 → ×5, „Leichte Fäden“ mit abnehmender Wirkung, Zone-3-Kostenanstieg 1,14 → 1,2, Entfernungsbonus weiter gedämpft (1400 → 2000).

## Offene Beobachtungen

- Chef: **Konkurrenzpilze wachsen evtl. zu schnell.** Bewusst noch nicht geändert – erst echte Daten (Statistik vom „Normal“-Handy mit ×1) abwarten. Stellschrauben: `CONFIG.rivals.interval`, `reachStep`, `maxReach`, `zone3.rivalReach`.
- Echte Spieldaten fehlen noch. Wenn der Chef den Statistik-Text schickt: Zeiten der Durchläufe (Spalten Z1/Z2/Z3) mit der Tabelle oben vergleichen.
