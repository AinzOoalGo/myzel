/** Alle sichtbaren Texte. Englisch kommt später als en.ts mit denselben Schlüsseln. */
export const de = {
  title: 'Myzel',
  version: 'Prototyp v0.2',

  res_n: 'Nährstoffe',
  res_sugar: 'Zucker',
  res_water: 'Wasser',
  per_sec: '{v}/s',
  net_progress: 'Netz {c}/{goal}',

  node_spore: 'Ursprung',
  node_laub: 'Laubschicht',
  node_totholz: 'Totholz',
  node_feucht: 'Feuchtstelle',
  node_baum: 'Baum',
  node_stein: 'Stein',

  desc_spore: 'Hier hat alles angefangen.',
  desc_laub: 'Kleiner, unerschöpflicher Nährstoffertrag.',
  desc_totholz: 'Viele Nährstoffe, aber der Vorrat geht zur Neige.',
  desc_feucht: 'Liefert Wasser für deine Baum-Partner.',
  desc_baum: 'Partnerschaft: Der Baum gibt dir Zucker, wenn du ihm Wasser lieferst.',
  desc_stein: 'Hindernis. Fäden müssen außen herum wachsen.',

  yield_n: '+{v} Nährstoffe/s',
  yield_water: '+{v} Wasser/s',
  yield_sugar: '+{v} Zucker/s (braucht {w} Wasser/s)',
  stock: 'Vorrat: {v}',
  depleted: 'Erschöpft',
  connected: 'Verbunden',

  grow_btn: 'Faden wachsen lassen · {cost}',
  grow_busy: 'Es wächst schon ein Faden.',
  grow_unreachable: 'Zu weit weg oder durch Steine versperrt.',
  grow_cost: 'Noch {missing} Nährstoffe nötig.',
  grow_rock: 'Steine kann man nicht besiedeln.',

  up_hyphen: 'Hyphenspitzen',
  up_hyphen_desc: '+1 Nährstoff pro Tipp',
  up_enzym: 'Zersetzer-Enzyme',
  up_enzym_desc: '+20 % Ertrag aus Laub und Totholz',
  up_frucht: 'Fruchtkörper',
  up_frucht_desc: '+1,5 Nährstoffe/s',
  up_rhizo: 'Rhizomorphe',
  up_rhizo_desc: 'Fäden 10 % billiger, 25 % schneller, mehr Reichweite',
  level: 'Stufe {v}',
  locked_sugar: 'Weitere Upgrades: Verbinde einen Baum, um Zucker zu bekommen.',
  upgrades: 'Wachstum',

  hint_start: 'Tippe auf den Boden, um Nährstoffe zu sammeln.',
  hint_select: 'Jetzt tippe auf einen gestrichelten Knoten in der Nähe.',
  hint_growing: 'Der Faden wächst. Tippen beschleunigt ihn.',
  hint_water: 'Dein Baum braucht Wasser: Verbinde eine Feuchtstelle (blau).',

  float_n: '+{v}',

  welcome_title: 'Willkommen zurück',
  welcome_body: 'Dein Netz hat in {t} weitergearbeitet und {v} Nährstoffe gesammelt.',
  zone_title: 'Zone 1 geschafft!',
  zone_body:
    'Dein Netz hat {c} Knoten verbunden – in {t} Spielzeit. Im fertigen Spiel folgt jetzt der Sporenflug (Prestige). Du kannst gern weiterspielen.',
  ok: 'Weiter',

  settings: 'Einstellungen',
  help: 'So geht’s',
  help_body:
    'Tippe auf den Boden für Nährstoffe. Tippe einen gestrichelten Knoten an und lass einen Faden dorthin wachsen. Verbundene Knoten arbeiten automatisch für dich – auch wenn das Spiel geschlossen ist (bis 12 Stunden).',
  legend: 'Legende',
  vibration: 'Vibration beim Tippen',
  export: 'Spielstand exportieren',
  export_hint: 'Diesen Text sicher aufbewahren, um den Spielstand später wiederherzustellen.',
  copy: 'Kopieren',
  copied: 'Kopiert',
  import: 'Spielstand importieren',
  import_btn: 'Laden',
  import_error: 'Dieser Text ist kein gültiger Spielstand.',
  reset: 'Neues Spiel',
  reset_confirm: 'Wirklich alles löschen? Nochmal tippen.',
  close: 'Schließen',
  storage_warning: 'Speichern ist in diesem Browser nicht möglich – nutze den Export.',
} as const;

export type TextKey = keyof typeof de;
