import { CONFIG, type Branch, type GenomeId, type UpgradeId } from './core/config';
import { ACHIEVEMENTS, checkAchievements } from './core/achievements';
import {
  buyGenome,
  canPrestige,
  catchGolden,
  genomeAvailable,
  has,
  mods,
  nodeYield,
  prestige,
  season,
  seasonLeft,
  sporeGain,
  canBuy,
  buy,
  computeRates,
  connectedCount,
  distanceBonus,
  growthQuote,
  newGame,
  startGrowth,
  sugarUnlocked,
  tap,
  tick,
  upgradeCost,
  type GameState,
} from './core/game';
import { formatDuration, formatNumber } from './core/format';
import { applyOffline, deserialize, exportString, importString, serialize } from './core/save';
import { t } from './i18n';
import type { TextKey } from './i18n/de';
import { NODE_COLORS, Renderer } from './ui/render';
import { clearSave, loadPrefs, loadRaw, saveRaw, savePrefs } from './ui/storage';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Element fehlt: ${sel}`);
  return el;
};
const fmt = formatNumber;

// ---------- Zustand laden ----------

let storageOk = true;
const prefs = loadPrefs();
/** Testmodus: Spieltempo (nur wenn CONFIG.testTools an ist) */
const speed = (): number => (CONFIG.testTools && CONFIG.testSpeeds.includes(prefs.speed) ? prefs.speed : 1);

/** Lädt den Spielstand (inkl. Offline-Ertrag) oder startet ein neues Spiel. */
function boot(): { state: GameState; welcome: { seconds: number; gained: number } | null } {
  const raw = loadRaw();
  if (raw) {
    try {
      const loaded = deserialize(raw);
      const savedAt = (raw as { savedAt?: number }).savedAt ?? Date.now();
      const off = applyOffline(loaded, savedAt, Date.now());
      return { state: loaded, welcome: off.seconds > 60 && off.gained > 0 ? off : null };
    } catch (err) {
      console.warn('Spielstand konnte nicht geladen werden, starte neu.', err);
    }
  }
  return { state: newGame(), welcome: null };
}

const booted = boot();
let state: GameState = booted.state;

function save(): void {
  storageOk = saveRaw(serialize(state, Date.now()));
}

// ---------- DOM ----------

const canvas = $<HTMLCanvasElement>('#cv');
const renderer = new Renderer(canvas);
const hintEl = $('#hint');
const cardEl = $('#card');
const upgradesEl = $('#upgrades');
const lockedEl = $('#locked');
const modalEl = $('#modal');
const modalBox = $('#modal .box');

const UPGRADE_IDS: UpgradeId[] = ['hyphen', 'enzym', 'frucht', 'rhizo'];
const upgradeRows = new Map<UpgradeId, { row: HTMLElement; level: HTMLElement; btn: HTMLButtonElement }>();

function buildUpgrades(): void {
  for (const id of UPGRADE_IDS) {
    const row = document.createElement('div');
    row.className = 'up';
    row.innerHTML = `<div class="up-text"><div class="up-name"><span></span> <small></small></div><div class="up-desc"></div></div><button class="buy"></button>`;
    row.querySelector('.up-name span')!.textContent = t(`up_${id}` as TextKey);
    row.querySelector('.up-desc')!.textContent = t(`up_${id}_desc` as TextKey);
    const btn = row.querySelector<HTMLButtonElement>('button')!;
    btn.addEventListener('click', () => {
      if (buy(state, id)) {
        haptic(15);
        updateUi(true);
      }
    });
    upgradesEl.appendChild(row);
    upgradeRows.set(id, { row, level: row.querySelector('small')!, btn });
  }
}

function costLabel(c: { n: number; sugar: number }): string {
  return c.sugar > 0 ? `${fmt(c.n)} N · ${fmt(c.sugar)} Z` : `${fmt(c.n)} N`;
}

function nodeDetails(id: number): string {
  const n = state.nodes[id]!;
  const b = distanceBonus(n);
  const m = mods(state);
  switch (n.type) {
    case 'laub':
      return t('yield_n', { v: fmt(nodeYield(state, n, m)) });
    case 'totholz':
      if (n.connected && n.stock <= 0) return t('depleted');
      return `${t('yield_n', { v: fmt(nodeYield(state, { ...n, stock: Math.max(n.stock, 1) }, m)) })} · ${t('stock', { v: fmt(n.stock * m.stock * m.global) })}`;
    case 'feucht':
      return t('yield_water', { v: fmt(CONFIG.nodes.feucht.water * b * m.water) });
    case 'baum':
    case 'altbaum':
      return t('yield_sugar', { v: fmt(CONFIG.nodes[n.type].sugar * b * m.sugar), w: fmt(CONFIG.nodes[n.type].waterUse) });
    case 'rivale':
      return n.connected ? t('yield_n', { v: fmt(nodeYield(state, n, m)) }) : '';
    default:
      return '';
  }
}

let cardFor: number | null = null;
function renderCard(): void {
  const id = renderer.selected;
  if (id === null) {
    cardEl.hidden = true;
    cardFor = null;
    return;
  }
  const n = state.nodes[id]!;
  if (cardFor !== id) {
    cardFor = id;
    cardEl.hidden = false;
    cardEl.innerHTML = `<div class="card-head"><span class="dot"></span><strong></strong><button class="x" aria-label="${t('close')}">×</button></div><div class="card-desc"></div><div class="card-yield"></div><button class="grow"></button><div class="card-why"></div>`;
    cardEl.querySelector<HTMLElement>('.dot')!.style.background = NODE_COLORS[n.type];
    cardEl.querySelector('strong')!.textContent = t(`node_${n.type}` as TextKey);
    const descKey: TextKey =
      n.type === 'rivale' && n.connected ? 'desc_rivale_beaten' : n.owner > 0 && n.type !== 'rivale' ? 'desc_owned' : (`desc_${n.type}` as TextKey);
    cardEl.querySelector('.card-desc')!.textContent = t(descKey);
    cardEl.querySelector('.x')!.addEventListener('click', () => {
      renderer.selected = null;
      renderCard();
    });
    cardEl.querySelector('.grow')!.addEventListener('click', () => {
      const r = startGrowth(state, id);
      if (r.ok) {
        haptic(20);
        renderer.selected = null;
        renderCard();
        updateUi(true);
      }
    });
  }
  cardEl.querySelector('.card-yield')!.textContent = n.connected ? `${t('connected')} · ${nodeDetails(id)}` : nodeDetails(id);
  const btn = cardEl.querySelector<HTMLButtonElement>('.grow')!;
  const why = cardEl.querySelector<HTMLElement>('.card-why')!;
  if (n.connected || n.type === 'spore') {
    btn.hidden = true;
    why.textContent = '';
    return;
  }
  if (n.type === 'stein') {
    btn.hidden = true;
    why.textContent = t('grow_rock');
    return;
  }
  const q = growthQuote(state, id);
  btn.hidden = !q;
  if (!q) {
    why.textContent = t('grow_unreachable');
    return;
  }
  const btnKey: TextKey = n.type === 'rivale' ? 'attack_btn' : n.owner > 0 ? 'reclaim_btn' : 'grow_btn';
  btn.textContent = t(btnKey, { cost: `${fmt(q.cost)} N` });
  if (state.growth) {
    btn.disabled = true;
    why.textContent = t('grow_busy');
  } else if (state.res.n < q.cost) {
    btn.disabled = true;
    why.textContent = t('grow_cost', { missing: fmt(q.cost - state.res.n) });
  } else {
    btn.disabled = false;
    why.textContent = '';
  }
}

function hint(): string {
  const now = state.stats.playSeconds;
  if (state.events.golden) return t('ev_gold', { t: formatDuration(Math.ceil(state.events.golden.until - now)) });
  const ev = state.events.active;
  if (ev && ev.until > now) return t(ev.type === 'regen' ? 'ev_regen' : 'ev_duerre', { t: formatDuration(Math.ceil(ev.until - now)) });
  const c = connectedCount(state);
  if (state.growth) return t('hint_growing', { t: formatDuration(Math.ceil(Renderer.growthEta(state) ?? 0)) });
  if (c === 0) return state.res.n < 20 ? t('hint_start') : t('hint_select');
  const rates = computeRates(state);
  if (sugarUnlocked(state) && rates.treeSupply < 1 && state.res.water < 1) return t('hint_water');
  return '';
}

function updateUi(force = false): void {
  const rates = computeRates(state);
  $('#res-n .v').textContent = fmt(state.res.n);
  $('#res-n .r').textContent = t('per_sec', { v: fmt(rates.n) });
  const sugarOn = sugarUnlocked(state);
  $('#res-sugar').hidden = !sugarOn;
  $('#res-sugar .v').textContent = fmt(state.res.sugar);
  const waterOn = state.nodes.some((n) => n.connected && n.type === 'feucht');
  $('#res-water').hidden = !waterOn;
  $('#res-water .v').textContent = fmt(state.res.water);
  $('#net').textContent =
    state.zone >= 2
      ? t('net_progress_z2', { c: connectedCount(state), goal: CONFIG.zone2.goal })
      : t('net_progress', { c: connectedCount(state), goal: CONFIG.zoneGoal });
  const sp = speed();
  $('#speed-badge').hidden = sp === 1;
  $('#speed-badge').textContent = t('test_badge', { v: sp });
  const se = season(state);
  $('#season').hidden = !se;
  if (se) $('#season').textContent = `${t(`season_${se}` as TextKey)} · ${formatDuration(Math.ceil(seasonLeft(state)))}`;
  $('#res-spores').hidden = state.meta.sporesTotal === 0;
  $('#res-spores .v').textContent = fmt(state.meta.spores);
  updateTabs();
  if (activeTab === 'genome') updatePrestigeBox();
  for (const id of checkAchievements(state)) {
    toast(t('ach_toast', { name: t(`ach_${id}` as TextKey) }));
    if (activeTab === 'ach') buildAchievements();
  }

  for (const id of UPGRADE_IDS) {
    const r = upgradeRows.get(id)!;
    const def = CONFIG.upgrades.find((u) => u.id === id)!;
    r.row.hidden = def.requiresSugar && !sugarOn;
    r.level.textContent = t('level', { v: state.levels[id] });
    r.btn.textContent = costLabel(upgradeCost(state, id));
    r.btn.disabled = !canBuy(state, id);
  }
  lockedEl.hidden = sugarOn;
  lockedEl.textContent = t('locked_sugar');
  $('#btn-center').hidden = !renderer.userMoved || !cardEl.hidden;
  const h = hint();
  hintEl.textContent = h;
  hintEl.hidden = !h;
  renderCard();
  if (force) renderer.draw(state, 0, performance.now() / 1000);

  if (state.zone >= 2 && !zone2Shown) {
    zone2Shown = true;
    zoneShown = true;
    renderer.startCelebration();
    showMessage(t('zone2_title'), t('zone2_body'));
  } else if (state.stats.zoneDoneAt !== null && !zoneShown) {
    zoneShown = true;
    renderer.startCelebration();
    showMessage(t('zone_title'), t('zone_body', { c: connectedCount(state), t: formatDuration(state.stats.zoneDoneAt) }));
  }
  if (state.stats.zone2DoneAt !== null && !zone2DoneShown) {
    zone2DoneShown = true;
    renderer.startCelebration();
    showMessage(t('zone2_done_title'), t('zone2_done_body', { c: connectedCount(state) }));
  }
}
let zoneShown = false;
let zone2Shown = false;
let zone2DoneShown = false;
/** Nach Laden, Import, Neustart oder Sporenflug: welche Meldungen sind schon „gesehen“? */
function syncShown(): void {
  zoneShown = state.stats.zoneDoneAt !== null || state.zone >= 2;
  zone2Shown = state.zone >= 2;
  zone2DoneShown = state.stats.zone2DoneAt !== null;
}

// ---------- Tabs: Wachstum · Genom · Erfolge ----------

type Tab = 'grow' | 'genome' | 'ach';
let activeTab: Tab = 'grow';
const TABS: Tab[] = ['grow', 'genome', 'ach'];

function setTab(tab: Tab): void {
  activeTab = tab;
  for (const tb of TABS) {
    $(`#tab-${tb}`).hidden = tb !== tab;
    $(`#tabs [data-tab="${tb}"]`).classList.toggle('on', tb === tab);
  }
  if (tab === 'genome') buildGenome();
  if (tab === 'ach') buildAchievements();
  $('#sheet').scrollTop = 0;
}

function genomeAffordable(): boolean {
  return CONFIG.genome.some((g) => genomeAvailable(state, g.id) && state.meta.spores >= g.cost);
}

function updateTabs(): void {
  $('#tabs [data-tab="genome"] .badge').hidden = !(canPrestige(state) || genomeAffordable());
  $('#tabs [data-tab="ach"] .count').textContent = `${state.meta.achievements.length}/${ACHIEVEMENTS.length}`;
}

function sporeBonusPct(): string {
  return fmt(CONFIG.prestige.sporeBonus * state.meta.sporesTotal * 100);
}

function updatePrestigeBox(): void {
  const btn = document.querySelector<HTMLButtonElement>('#prestige-btn');
  const need = document.querySelector<HTMLElement>('#prestige-need');
  if (!btn || !need) return;
  const ok = canPrestige(state);
  btn.disabled = !ok;
  btn.textContent = t('prestige_btn', { v: fmt(sporeGain(state)) });
  const c = connectedCount(state);
  need.textContent = c < CONFIG.prestige.minNodes ? t('prestige_need', { n: CONFIG.prestige.minNodes, c }) : t('prestige_more');
}

function buildGenome(): void {
  const box = $('#tab-genome');
  box.innerHTML = '';
  const pr = el('div', '', 'prestige');
  pr.append(el('strong', t('prestige_title')), el('p', t('prestige_desc'), 'small'));
  const btn = el('button', '', 'buy wide');
  btn.id = 'prestige-btn';
  btn.addEventListener('click', confirmPrestige);
  const need = el('p', '', 'small');
  need.id = 'prestige-need';
  pr.append(btn, need);
  box.append(pr, el('p', t('spores_have', { v: fmt(state.meta.spores), b: sporeBonusPct() }), 'spores-line'));
  for (const branch of ['zersetzer', 'symbiont', 'pionier'] as Branch[]) {
    box.append(el('h3', t(`branch_${branch}` as TextKey), 'branch'));
    for (const g of CONFIG.genome.filter((x) => x.branch === branch)) {
      const row = el('div', '', 'up');
      const text = el('div', '', 'up-text');
      text.append(el('div', t(`g_${g.id}` as TextKey), 'up-name'), el('div', t(`g_${g.id}_desc` as TextKey), 'up-desc'));
      const owned = has(state, g.id);
      const b = el('button', owned ? t('genome_owned') : `${g.cost} Sp.`, 'buy');
      b.disabled = owned || !genomeAvailable(state, g.id) || state.meta.spores < g.cost;
      if (owned) b.classList.add('owned');
      if (!owned && !genomeAvailable(state, g.id)) b.title = t('genome_locked');
      b.addEventListener('click', () => {
        if (buyGenome(state, g.id as GenomeId)) {
          haptic(20);
          save();
          buildGenome();
          updateUi(true);
        }
      });
      row.append(text, b);
      box.append(row);
    }
  }
  updatePrestigeBox();
}

function buildAchievements(): void {
  const box = $('#tab-ach');
  box.innerHTML = '';
  const n = state.meta.achievements.length;
  box.append(el('p', t('ach_header', { c: n, t: ACHIEVEMENTS.length, b: fmt(n * CONFIG.achievementBonus * 100) }), 'spores-line'));
  for (const a of ACHIEVEMENTS) {
    const done = state.meta.achievements.includes(a.id);
    const row = el('div', '', `ach${done ? ' done' : ''}`);
    row.append(el('span', done ? '✓' : '·', 'ach-mark'));
    const text = el('div', '', 'up-text');
    text.append(el('div', t(`ach_${a.id}` as TextKey), 'up-name'), el('div', t(`ach_${a.id}_desc` as TextKey), 'up-desc'));
    row.append(text);
    box.append(row);
  }
}

function confirmPrestige(): void {
  if (!canPrestige(state)) return;
  const gain = sporeGain(state);
  openModal((box) => {
    box.append(el('h2', t('prestige_confirm_title')), el('p', t('prestige_confirm_body', { v: fmt(gain) })));
    const go = el('button', t('prestige_confirm'), 'primary');
    go.addEventListener('click', () => {
      const next = prestige(state);
      if (!next) return closeModal();
      state = next;
      renderer.selected = null;
      renderer.reset();
      syncShown();
      checkAchievements(state);
      save();
      setTab('genome');
      updateUi(true);
      showMessage(t('prestige_done_title'), t('prestige_done_body'));
    });
    const no = el('button', t('cancel'));
    no.addEventListener('click', closeModal);
    box.append(go, no);
  });
}

// ---------- Hinweise ----------

const toastEl = $('#toast');
const toastQueue: string[] = [];
let toastBusy = false;
function toast(text: string): void {
  toastQueue.push(text);
  if (!toastBusy) nextToast();
}
function nextToast(): void {
  const text = toastQueue.shift();
  if (!text) {
    toastBusy = false;
    return;
  }
  toastBusy = true;
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.hidden = true;
    nextToast();
  }, 2600);
}

// ---------- Eingabe ----------

function haptic(ms: number): void {
  if (prefs.vibration && 'vibrate' in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* nicht unterstützt */
    }
  }
}

/** Tippen sofort beim Berühren (wichtig fürs Spielgefühl); Ziehen verschiebt, zwei Finger zoomen. */
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
let dragMoved = 0;
const local = (e: PointerEvent | WheelEvent): [number, number] => {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
};

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* nicht unterstützt */
  }
  const [sx, sy] = local(e);
  pointers.set(e.pointerId, { x: sx, y: sy });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    return;
  }
  if (pointers.size > 2) return;
  dragMoved = 0;
  const hit = renderer.hitTest(state, sx, sy);
  if (state.events.golden && renderer.hitGolden(state, sx, sy)) {
    const v = catchGolden(state);
    renderer.tapFeedback(sx, sy, t('gold_float', { v: fmt(v) }));
    renderer.connectedBurstAt(sx, sy);
    haptic(40);
  } else if (hit && !hit.connected) {
    renderer.selected = hit.id;
    haptic(8);
  } else {
    const v = tap(state);
    renderer.tapFeedback(sx, sy, t('float_n', { v: fmt(v) }));
    haptic(6);
    if (hit) renderer.selected = hit.type === 'spore' ? null : hit.id;
  }
  updateUi();
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const [sx, sy] = local(e);
  pointers.set(e.pointerId, { x: sx, y: sy });
  if (pointers.size === 1) {
    dragMoved += Math.hypot(sx - prev.x, sy - prev.y);
    if (dragMoved > 12) renderer.panBy(sx - prev.x, sy - prev.y);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinchDist > 0) renderer.zoomAt(d / pinchDist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
    pinchDist = d;
  }
});

const release = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinchDist = 0;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    renderer.zoomAt(Math.exp(-e.deltaY * 0.0015), sx, sy);
  },
  { passive: false },
);
$('#btn-center').addEventListener('click', () => renderer.resetView());

// ---------- Dialoge ----------

function openModal(build: (box: HTMLElement) => void): void {
  modalBox.innerHTML = '';
  build(modalBox);
  modalEl.hidden = false;
}
function closeModal(): void {
  modalEl.hidden = true;
}
modalEl.addEventListener('click', (e) => {
  if (e.target === modalEl) closeModal();
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function showMessage(title: string, body: string): void {
  openModal((box) => {
    box.append(el('h2', title), el('p', body));
    const ok = el('button', t('ok'), 'primary');
    ok.addEventListener('click', closeModal);
    box.append(ok);
  });
}

function showSettings(): void {
  openModal((box) => {
    box.append(el('h2', t('settings')));
    box.append(el('h3', t('help')), el('p', t('help_body')));
    const legend = el('div', '', 'legend');
    for (const type of ['laub', 'totholz', 'feucht', 'baum', 'stein', 'altbaum', 'rivale'] as const) {
      const item = el('span', '', 'legend-item');
      const dot = el('i', '', type === 'stein' ? 'hex' : '');
      dot.style.background = NODE_COLORS[type];
      item.append(dot, document.createTextNode(t(`node_${type}` as TextKey)));
      legend.append(item);
    }
    box.append(el('h3', t('legend')), legend);

    const vib = el('label', '', 'toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = prefs.vibration;
    cb.addEventListener('change', () => {
      prefs.vibration = cb.checked;
      savePrefs(prefs);
    });
    vib.append(cb, document.createTextNode(` ${t('vibration')}`));
    box.append(vib);
    const rm = el('label', '', 'toggle');
    const rmCb = el('input');
    rmCb.type = 'checkbox';
    rmCb.checked = prefs.reducedMotion;
    rmCb.addEventListener('change', () => {
      prefs.reducedMotion = rmCb.checked;
      renderer.reducedMotion = rmCb.checked;
      savePrefs(prefs);
    });
    rm.append(rmCb, document.createTextNode(` ${t('reduced_motion')}`));
    box.append(rm);

    if (CONFIG.testTools) {
      box.append(el('h3', t('test_title')), el('p', t('test_hint'), 'small'));
      const row = el('div', '', 'speed-row');
      for (const v of CONFIG.testSpeeds) {
        const b = el('button', `×${v}`, v === speed() ? 'on' : '');
        b.addEventListener('click', () => {
          prefs.speed = v;
          savePrefs(prefs);
          row.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          updateUi();
        });
        row.append(b);
      }
      box.append(row);
    }

    if (!storageOk) box.append(el('p', t('storage_warning'), 'warn'));

    box.append(el('h3', t('export')), el('p', t('export_hint'), 'small'));
    const out = el('textarea');
    out.readOnly = true;
    out.value = exportString(state, Date.now());
    const copy = el('button', t('copy'));
    copy.addEventListener('click', async () => {
      out.select();
      try {
        await navigator.clipboard.writeText(out.value);
      } catch {
        document.execCommand('copy');
      }
      copy.textContent = t('copied');
    });
    box.append(out, copy);

    box.append(el('h3', t('import')));
    const inp = el('textarea');
    const err = el('p', '', 'warn');
    const load = el('button', t('import_btn'));
    load.addEventListener('click', () => {
      try {
        const r = importString(inp.value);
        state = r.state;
        renderer.selected = null;
        renderer.reset();
        syncShown();
        save();
        closeModal();
        updateUi(true);
      } catch {
        err.textContent = t('import_error');
      }
    });
    box.append(inp, load, err);

    const reset = el('button', t('reset'), 'danger');
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = t('reset_confirm');
        return;
      }
      clearSave();
      state = newGame();
      renderer.selected = null;
      renderer.reset();
      syncShown();
      save();
      closeModal();
      updateUi(true);
    });
    const close = el('button', t('close'), 'primary');
    close.addEventListener('click', closeModal);
    box.append(el('hr'), reset, close, el('p', t('version'), 'small center'));
  });
}
$('#btn-settings').addEventListener('click', showSettings);

// ---------- Spielschleife ----------

const DT = 1 / CONFIG.ticksPerSecond;
let acc = 0;
let last = performance.now();
let uiAcc = 0;
let saveAcc = 0;

function frame(now: number): void {
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 5) {
    // Tab war im Hintergrund: wie Offline-Zeit nachholen
    const off = applyOffline(state, Date.now() - elapsed * 1000, Date.now());
    if (off.seconds > 60 && off.gained > 0) showMessage(t('welcome_title'), t('welcome_body', { t: formatDuration(off.seconds), v: fmt(off.gained) }));
    elapsed = 0;
  }
  // im Testmodus läuft die Spielzeit schneller (Produktion, Wachstum, Ereignisse, Jahreszeiten, Rivalen)
  acc += elapsed * speed();
  const edgesBefore = state.edges.length;
  while (acc >= DT) {
    tick(state, DT);
    acc -= DT;
  }
  if (state.edges.length > edgesBefore) {
    renderer.connectedBurst(state, state.edges[state.edges.length - 1]!.to);
    haptic(25);
  }
  renderer.draw(state, elapsed, now / 1000);
  uiAcc += elapsed;
  if (uiAcc > 0.1) {
    uiAcc = 0;
    updateUi();
  }
  saveAcc += elapsed;
  if (saveAcc > CONFIG.autosaveSeconds) {
    saveAcc = 0;
    save();
  }
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('pagehide', save);
// Größe neu messen, wenn sich die Fläche ändert (Fenster, Infokarte ein/aus, Drehen)
new ResizeObserver(() => renderer.resize()).observe(canvas);

$('#title').textContent = t('title');
$('#res-n .l').textContent = t('res_n');
$('#btn-center').textContent = `⌖ ${t('center')}`;
$('#res-sugar .l').textContent = t('res_sugar');
$('#res-water .l').textContent = t('res_water');
$('#res-spores .l').textContent = t('res_spores');
for (const tb of TABS) {
  const b = $(`#tabs [data-tab="${tb}"]`);
  b.querySelector('.label')!.textContent = t(`tab_${tb}` as TextKey);
  b.addEventListener('click', () => setTab(tb));
}
buildUpgrades();
setTab('grow');
checkAchievements(state);
renderer.reducedMotion = prefs.reducedMotion;
renderer.resize();
syncShown();
updateUi(true);
if (booted.welcome) {
  showMessage(t('welcome_title'), t('welcome_body', { t: formatDuration(booted.welcome.seconds), v: fmt(booted.welcome.gained) }));
}
save();
requestAnimationFrame(frame);
