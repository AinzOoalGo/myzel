import type { NodeType } from '../core/config';
import { findSource, growthSpeed, reach, type GameState } from '../core/game';
import type { MapNode } from '../core/map';
import { createRng } from '../core/rng';
import { buildHypha, pointAt, subtreeWeights, type Hypha, type Path } from './geometry';

/**
 * Darstellung „biolumineszenter Untergrund“ (Phase 3), Canvas 2D.
 * Gezeichnet wird in Weltkoordinaten; die Kamera steckt in einer einzigen Transformation.
 */

export const NODE_COLORS: Record<NodeType, string> = {
  spore: '#fff1d6',
  laub: '#b5a347',
  totholz: '#9a6235',
  feucht: '#4f9be0',
  baum: '#4fae63',
  stein: '#86817a',
};

const GLOW_WARM = 'rgba(255,196,120,';
const CORE = 'rgba(255,240,214,';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
}
interface Float {
  x: number;
  y: number;
  text: string;
  age: number;
}
interface Ripple {
  x: number;
  y: number;
  age: number;
}

function makeSprite(inner: string, outer: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** Erdige Bodentextur, einmal erzeugt und gekachelt. */
function makeSoil(): HTMLCanvasElement {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16120e';
  g.fillRect(0, 0, size, size);
  const rng = createRng(77);
  for (let i = 0; i < 260; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 2 + rng() * 22;
    const a = 0.025 + rng() * 0.05;
    const light = rng() < 0.5;
    g.fillStyle = light ? `rgba(70,55,38,${a})` : `rgba(0,0,0,${a * 1.5})`;
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, r, r * (0.5 + rng() * 0.5), rng() * 3, 0, Math.PI * 2);
        g.fill();
      }
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${rng() < 0.5 ? '120,100,80' : '20,15,10'},${0.08 + rng() * 0.12})`;
    g.fillRect(rng() * size, rng() * size, 1, 1);
  }
  return c;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** automatische Kamera (folgt dem Netz) */
  private auto = { x: 0, y: 0, scale: 1 };
  /** wirksame Kamera */
  private cam = { x: 0, y: 0, scale: 1 };
  private camReady = false;
  /** Eingriffe des Spielers: Zoomfaktor und Verschiebung in Welteinheiten */
  userZoom = 1;
  userPan = { x: 0, y: 0 };
  reducedMotion = false;

  private floats: Float[] = [];
  private ripples: Ripple[] = [];
  private sparks: Particle[] = [];
  private dust: Particle[] = [];
  private energy = 0; // kurzes Aufleuchten nach Tipps
  private celebrate = 0;

  private cacheKey = '';
  private visible: MapNode[] = [];
  private sightAlpha = new Map<number, number>();
  private reachable = new Set<number>();
  private hyphae = new Map<string, Hypha>();
  private weights = new Map<number, number>();
  private growthPath: { key: string; hypha: Hypha } | null = null;

  private glowWarm = makeSprite('rgba(255,236,200,1)', 'rgba(255,170,90,0.35)');
  private glowGreen = makeSprite('rgba(200,255,200,0.9)', 'rgba(80,190,110,0.25)');
  private glowBlue = makeSprite('rgba(210,235,255,0.9)', 'rgba(80,150,230,0.25)');
  private soil: CanvasPattern | null;
  selected: number | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas wird nicht unterstützt');
    this.ctx = ctx;
    this.soil = ctx.createPattern(makeSoil(), 'repeat');
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.seedDust();
  }

  private seedDust(): void {
    const rng = createRng(5);
    this.dust = Array.from({ length: 28 }, () => ({
      x: rng() * this.w,
      y: rng() * this.h,
      vx: (rng() - 0.5) * 6,
      vy: -2 - rng() * 5,
      age: rng() * 10,
      life: 10,
      size: 0.6 + rng() * 1.4,
    }));
  }

  // ---------- Kamera ----------

  get userMoved(): boolean {
    return Math.abs(this.userZoom - 1) > 0.02 || Math.hypot(this.userPan.x, this.userPan.y) > 4;
  }

  resetView(): void {
    this.userZoom = 1;
    this.userPan = { x: 0, y: 0 };
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.userPan.x -= dxScreen / this.cam.scale;
    this.userPan.y -= dyScreen / this.cam.scale;
    this.clampPan();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.toWorld(sx, sy);
    this.userZoom = Math.max(0.5, Math.min(4, this.userZoom * factor));
    // Kamera sofort anpassen, damit der Punkt unter dem Finger bleibt
    this.cam.scale = this.auto.scale * this.userZoom;
    const after = this.toWorld(sx, sy);
    this.userPan.x += before[0] - after[0];
    this.userPan.y += before[1] - after[1];
    this.cam.x = this.auto.x + this.userPan.x;
    this.cam.y = this.auto.y + this.userPan.y;
    this.clampPan();
  }

  private clampPan(): void {
    const lim = 900;
    this.userPan.x = Math.max(-lim, Math.min(lim, this.userPan.x));
    this.userPan.y = Math.max(-lim, Math.min(lim, this.userPan.y));
  }

  private updateCamera(s: GameState, dt: number): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of s.nodes) {
      if (!n.connected) continue;
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const margin = reach(s) + 30;
    const hw = Math.max(200, (maxX - minX) / 2 + margin);
    const hh = Math.max(200, (maxY - minY) / 2 + margin);
    const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale: Math.min(this.w / (2 * hw), this.h / (2 * hh)) };
    if (this.celebrate > 0) target.scale *= 0.8;
    const k = this.camReady ? 1 - Math.exp(-dt * 2) : 1;
    this.camReady = true;
    this.auto.x += (target.x - this.auto.x) * k;
    this.auto.y += (target.y - this.auto.y) * k;
    this.auto.scale += (target.scale - this.auto.scale) * k;
    this.cam.x = this.auto.x + this.userPan.x;
    this.cam.y = this.auto.y + this.userPan.y;
    this.cam.scale = this.auto.scale * this.userZoom;
  }

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.scale + this.w / 2, (y - this.cam.y) * this.cam.scale + this.h / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.cam.scale + this.cam.x, (sy - this.h / 2) / this.cam.scale + this.cam.y];
  }

  // ---------- Zwischenspeicher ----------

  private refresh(s: GameState): void {
    const key = `${s.seed}|${s.edges.length}|${s.levels.rhizo}|${s.growth ? s.growth.to : -1}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    const r = reach(s);
    const connected = s.nodes.filter((n) => n.connected);
    const sight = r * 1.7;
    this.visible = [];
    this.sightAlpha.clear();
    for (const n of s.nodes) {
      let d = Infinity;
      for (const c of connected) d = Math.min(d, Math.hypot(c.x - n.x, c.y - n.y));
      if (d > sight) continue;
      this.visible.push(n);
      // hinter der Reichweite langsam im Nebel verschwinden
      this.sightAlpha.set(n.id, d <= r ? 1 : Math.max(0.12, 1 - (d - r) / (sight - r)));
    }
    this.reachable = new Set(this.visible.filter((n) => !n.connected && findSource(s, n.id)).map((n) => n.id));
    for (const e of s.edges) {
      const k = `${e.from}>${e.to}`;
      if (!this.hyphae.has(k)) this.hyphae.set(k, buildHypha(s.nodes[e.from]!, s.nodes[e.to]!));
    }
    // bei neuem Spiel/Import alte Fäden verwerfen
    if (this.hyphae.size > s.edges.length + 2) {
      const keep = new Set(s.edges.map((e) => `${e.from}>${e.to}`));
      for (const k of this.hyphae.keys()) if (!keep.has(k)) this.hyphae.delete(k);
    }
    this.weights = subtreeWeights(s.edges);
    if (s.growth) {
      const gk = `${s.growth.from}>${s.growth.to}`;
      if (this.growthPath?.key !== gk) this.growthPath = { key: gk, hypha: buildHypha(s.nodes[s.growth.from]!, s.nodes[s.growth.to]!) };
    } else this.growthPath = null;
  }

  /** Nach Neustart/Import: Kamera und Fäden neu aufbauen. */
  reset(): void {
    this.cacheKey = '';
    this.hyphae.clear();
    this.camReady = false;
    this.resetView();
  }

  hitTest(s: GameState, sx: number, sy: number): MapNode | null {
    let best: MapNode | null = null;
    let bestD = Infinity;
    for (const n of this.visible) {
      const [x, y] = this.toScreen(n.x, n.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < n.r * this.cam.scale + 16 && d < bestD) {
        best = s.nodes[n.id] ?? null;
        bestD = d;
      }
    }
    return best;
  }

  // ---------- Effekte ----------

  tapFeedback(sx: number, sy: number, text: string): void {
    this.floats.push({ x: sx, y: sy, text, age: 0 });
    if (this.floats.length > 30) this.floats.shift();
    this.ripples.push({ x: sx, y: sy, age: 0 });
    if (this.ripples.length > 12) this.ripples.shift();
    this.energy = Math.min(1, this.energy + 0.12);
    if (this.reducedMotion) return;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 40 + Math.random() * 90;
      this.sparks.push({ x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.45 + Math.random() * 0.3, size: 1 + Math.random() * 1.5 });
    }
    if (this.sparks.length > 160) this.sparks.splice(0, this.sparks.length - 160);
  }

  connectedBurst(s: GameState, nodeId: number): void {
    const n = s.nodes[nodeId];
    if (!n) return;
    const [sx, sy] = this.toScreen(n.x, n.y);
    this.energy = 1;
    if (this.reducedMotion) return;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const v = 50 + Math.random() * 60;
      this.sparks.push({ x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0.7, size: 1.5 + Math.random() });
    }
  }

  startCelebration(): void {
    this.celebrate = 4;
    this.energy = 1;
  }

  // ---------- Zeichnen ----------

  draw(s: GameState, dt: number, time: number): void {
    this.refresh(s);
    this.updateCamera(s, dt);
    this.energy = Math.max(this.celebrate > 0 ? 0.8 : 0, this.energy - dt * 0.8);
    this.celebrate = Math.max(0, this.celebrate - dt);
    const { ctx } = this;
    const sc = this.cam.scale;
    const px = 1 / sc; // ein Bildschirmpixel in Welteinheiten

    // Boden (in Weltkoordinaten, verschiebt sich mit)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#16120e';
    ctx.fillRect(0, 0, this.w, this.h);
    this.applyWorld();
    if (this.soil) {
      const [x0, y0] = this.toWorld(0, 0);
      const [x1, y1] = this.toWorld(this.w, this.h);
      ctx.save();
      ctx.scale(2, 2); // Textur gröber als die Welt
      ctx.fillStyle = this.soil;
      ctx.fillRect(x0 / 2, y0 / 2, (x1 - x0) / 2, (y1 - y0) / 2);
      ctx.restore();
    }

    // Steine und unverbundene Knoten unter den Fäden
    for (const n of this.visible) if (!n.connected) this.drawNode(n, time, px);

    // Fäden: additive Mischung ergibt das Leuchten
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const boost = 1 + this.energy * 0.7;
    for (const e of s.edges) {
      const h = this.hyphae.get(`${e.from}>${e.to}`);
      if (!h) continue;
      const wgt = this.weights.get(e.to) ?? 1;
      const width = Math.max(1.2 * px, 1.6 + Math.log2(wgt) * 0.9);
      this.strokeHypha(h, h.main.total, width, boost, px);
    }
    if (s.growth && this.growthPath) {
      const h = this.growthPath.hypha;
      const len = Math.min(1, s.growth.progress / s.growth.length) * h.main.total;
      // Vorschau des Wegs
      ctx.setLineDash([3 * px, 6 * px]);
      ctx.strokeStyle = `${CORE}0.18)`;
      ctx.lineWidth = 1.2 * px;
      this.tracePath(h.main, h.main.total);
      ctx.stroke();
      ctx.setLineDash([]);
      this.strokeHypha(h, len, 1.8, boost * 1.2, px);
      const [tx, ty] = pointAt(h.main, len);
      const pulse = 22 + Math.sin(time * 9) * 5;
      this.sprite(this.glowWarm, tx, ty, pulse * px * 2.2, 0.95);
    }

    // Nährstoff-Pulse wandern zum Ursprung
    if (!this.reducedMotion) {
      const speed = 45;
      for (const e of s.edges) {
        const h = this.hyphae.get(`${e.from}>${e.to}`);
        if (!h) continue;
        const total = h.main.total;
        const n = s.nodes[e.to]!;
        const producing = n.type !== 'totholz' || n.stock > 0;
        const count = producing ? 1 + Math.min(2, Math.floor((this.weights.get(e.to) ?? 1) / 4)) : 0;
        for (let i = 0; i < count; i++) {
          const phase = (time * speed + (e.to * 37 + i * total) / (count || 1)) % total;
          const [x, y] = pointAt(h.main, total - phase);
          this.sprite(this.glowWarm, x, y, 16 * px + 6, 0.55 + this.energy * 0.4);
        }
      }
    }

    // verbundene Knoten über den Fäden
    ctx.globalCompositeOperation = 'source-over';
    for (const n of this.visible) if (n.connected) this.drawNode(n, time, px);

    // Auswahlring
    if (this.selected !== null) {
      const n = s.nodes[this.selected];
      if (n) {
        ctx.strokeStyle = '#ffd68c';
        ctx.lineWidth = 2.2 * px;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 7 * px + 4 + Math.sin(time * 5) * 1.5 * px, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ---- Bildschirmebene ----
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Vignette
    const vg = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.3, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.globalCompositeOperation = 'lighter';
    if (!this.reducedMotion) {
      for (const d of this.dust) {
        d.age += dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y < -5) d.y = this.h + 5;
        if (d.x < -5) d.x = this.w + 5;
        if (d.x > this.w + 5) d.x = -5;
        const a = 0.12 + 0.1 * Math.sin(d.age * 0.8 + d.x);
        ctx.fillStyle = `rgba(255,220,170,${a})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const p of this.sparks) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      const a = 1 - p.age / p.life;
      if (a > 0) this.sprite(this.glowWarm, p.x, p.y, p.size * 9, a);
    }
    this.sparks = this.sparks.filter((p) => p.age < p.life);
    for (const rp of this.ripples) {
      rp.age += dt;
      const a = 1 - rp.age / 0.55;
      if (a <= 0) continue;
      ctx.strokeStyle = `rgba(255,214,140,${a * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 6 + rp.age * 70, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.age < 0.55);
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      f.age += dt;
      const a = 1 - f.age / 0.9;
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,228,180,${a})`;
      ctx.fillText(f.text, f.x, f.y - 16 - f.age * 55);
    }
    this.floats = this.floats.filter((f) => f.age < 0.9);
  }

  private applyWorld(): void {
    const sc = this.cam.scale;
    const d = this.dpr;
    this.ctx.setTransform(d * sc, 0, 0, d * sc, d * (this.w / 2 - this.cam.x * sc), d * (this.h / 2 - this.cam.y * sc));
  }

  private sprite(img: HTMLCanvasElement, x: number, y: number, size: number, alpha: number): void {
    this.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    this.ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    this.ctx.globalAlpha = 1;
  }

  private tracePath(p: Path, upTo: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(p.xs[0]!, p.ys[0]!);
    for (let i = 1; i < p.xs.length; i++) {
      if (p.cum[i]! >= upTo) {
        const [x, y] = pointAt(p, upTo);
        ctx.lineTo(x, y);
        return;
      }
      ctx.lineTo(p.xs[i]!, p.ys[i]!);
    }
  }

  /** Drei Lagen: breiter Schein, mittlerer Schein, heller Kern. */
  private strokeHypha(h: Hypha, upTo: number, width: number, boost: number, px: number): void {
    const { ctx } = this;
    this.tracePath(h.main, upTo);
    ctx.strokeStyle = `${GLOW_WARM}${0.07 * boost})`;
    ctx.lineWidth = width * 5 + 4 * px;
    ctx.stroke();
    ctx.strokeStyle = `${GLOW_WARM}${0.16 * boost})`;
    ctx.lineWidth = width * 2.2;
    ctx.stroke();
    ctx.strokeStyle = `${CORE}${Math.min(1, 0.75 * boost)})`;
    ctx.lineWidth = Math.max(px, width * 0.8);
    ctx.stroke();
    const done = upTo / h.main.total;
    ctx.lineWidth = Math.max(0.8 * px, width * 0.3);
    for (const hair of h.hairs) {
      if (hair.at > done) continue;
      const grow = Math.min(1, (done - hair.at) * 6);
      this.tracePath(hair.path, hair.path.total * grow);
      ctx.strokeStyle = `${CORE}${0.35 * boost})`;
      ctx.stroke();
    }
  }

  private drawNode(n: MapNode, time: number, px: number): void {
    const { ctx } = this;
    const alpha = n.connected ? 1 : (this.sightAlpha.get(n.id) ?? 1) * (n.type === 'stein' ? 0.85 : 0.55);
    const rng = createRng(n.id * 9301 + 49297);
    const r = n.r;
    ctx.globalAlpha = alpha;
    switch (n.type) {
      case 'spore': {
        ctx.globalAlpha = 1;
        const p = 1 + Math.sin(time * 2) * 0.08;
        ctx.globalCompositeOperation = 'lighter';
        this.sprite(this.glowWarm, n.x, n.y, r * 7 * p, 0.9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = NODE_COLORS.spore;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.65 * p, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'laub': {
        for (let i = 0; i < 3; i++) {
          const a = rng() * Math.PI * 2;
          const ox = Math.cos(a) * r * 0.35;
          const oy = Math.sin(a) * r * 0.35;
          ctx.fillStyle = ['#b5a347', '#c08a3a', '#8e8a3c'][i]!;
          ctx.beginPath();
          ctx.ellipse(n.x + ox, n.y + oy, r * 0.75, r * 0.38, a + 0.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(40,30,10,0.5)';
          ctx.lineWidth = Math.max(0.6 * px, r * 0.06);
          ctx.beginPath();
          ctx.moveTo(n.x + ox - Math.cos(a + 0.6) * r * 0.6, n.y + oy - Math.sin(a + 0.6) * r * 0.6);
          ctx.lineTo(n.x + ox + Math.cos(a + 0.6) * r * 0.6, n.y + oy + Math.sin(a + 0.6) * r * 0.6);
          ctx.stroke();
        }
        break;
      }
      case 'totholz': {
        const depleted = n.connected && n.stock <= 0;
        const rot = rng() * Math.PI;
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.rotate(rot);
        ctx.fillStyle = depleted ? '#3d342b' : '#6e4524';
        ctx.beginPath();
        ctx.roundRect(-r * 1.2, -r * 0.55, r * 2.4, r * 1.1, r * 0.5);
        ctx.fill();
        ctx.fillStyle = depleted ? '#51473c' : NODE_COLORS.totholz;
        ctx.beginPath();
        ctx.ellipse(r * 1.05, 0, r * 0.32, r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = depleted ? 'rgba(20,15,10,0.6)' : 'rgba(60,35,15,0.8)';
        ctx.lineWidth = Math.max(0.6 * px, r * 0.07);
        ctx.beginPath();
        ctx.ellipse(r * 1.05, 0, r * 0.16, r * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -r * 0.15);
        ctx.lineTo(r * 0.5, -r * 0.2);
        ctx.moveTo(-r * 0.6, r * 0.2);
        ctx.lineTo(r * 0.7, r * 0.15);
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'feucht': {
        if (n.connected) {
          ctx.globalCompositeOperation = 'lighter';
          this.sprite(this.glowBlue, n.x, n.y, r * 4.5, 0.45 + Math.sin(time * 1.5 + n.id) * 0.1);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.fillStyle = '#2c5f93';
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, r, r * 0.8, rng(), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = NODE_COLORS.feucht;
        ctx.beginPath();
        ctx.ellipse(n.x - r * 0.15, n.y - r * 0.1, r * 0.65, r * 0.5, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(220,240,255,0.7)';
        ctx.beginPath();
        ctx.ellipse(n.x - r * 0.35, n.y - r * 0.3, r * 0.2, r * 0.12, 0.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'baum': {
        if (n.connected) {
          ctx.globalCompositeOperation = 'lighter';
          this.sprite(this.glowGreen, n.x, n.y, r * 4.5, 0.45);
          ctx.globalCompositeOperation = 'source-over';
        }
        // Wurzeln
        ctx.strokeStyle = '#3d2c1c';
        ctx.lineWidth = Math.max(0.8 * px, r * 0.12);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + rng();
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.quadraticCurveTo(n.x + Math.cos(a + 0.4) * r * 0.9, n.y + Math.sin(a + 0.4) * r * 0.9, n.x + Math.cos(a) * r * 1.35, n.y + Math.sin(a) * r * 1.35);
          ctx.stroke();
        }
        ctx.fillStyle = '#2f6b3b';
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.95, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = NODE_COLORS.baum;
        ctx.beginPath();
        ctx.arc(n.x - r * 0.15, n.y - r * 0.15, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8fd49b';
        ctx.beginPath();
        ctx.arc(n.x - r * 0.35, n.y - r * 0.35, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'stein': {
        const pts: [number, number][] = [];
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + rng() * 0.4;
          const rr = r * (0.75 + rng() * 0.3);
          pts.push([n.x + Math.cos(a) * rr, n.y + Math.sin(a) * rr]);
        }
        ctx.fillStyle = '#4e4a45';
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + r * 0.12) : ctx.moveTo(x, y + r * 0.12)));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = NODE_COLORS.stein;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.ellipse(n.x - r * 0.25, n.y - r * 0.3, r * 0.35, r * 0.2, -0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
    ctx.globalAlpha = 1;
    // erreichbare Knoten: rotierender gestrichelter Ring
    if (this.reachable.has(n.id)) {
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.lineDashOffset = -time * 8 * px;
      ctx.strokeStyle = 'rgba(255,236,200,0.85)';
      ctx.lineWidth = 1.4 * px;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * (n.type === 'totholz' ? 1.35 : 1.15) + 4 * px, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
  }

  /** Für die Anzeige der Wachstumsdauer. */
  static growthEta(s: GameState): number | null {
    if (!s.growth) return null;
    return (s.growth.length - s.growth.progress) / growthSpeed(s);
  }
}
