import type { NodeType } from '../core/config';
import { findSource, reach, type GameState } from '../core/game';
import type { MapNode } from '../core/map';

/** Graubox-Darstellung (Phase 2). Die finale Netz-Grafik kommt in Phase 3. */

export const NODE_COLORS: Record<NodeType, string> = {
  spore: '#f3e7cf',
  laub: '#a3a64a',
  totholz: '#a0683a',
  feucht: '#4f8fd0',
  baum: '#4fa35c',
  stein: '#77736d',
};

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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private cam = { x: 0, y: 0, scale: 1 };
  private camReady = false;
  private floats: Float[] = [];
  private ripples: Ripple[] = [];
  private cacheKey = '';
  private visible: MapNode[] = [];
  private reachable = new Set<number>();
  selected: number | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas wird nicht unterstützt');
    this.ctx = ctx;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  /** Sichtbare und erreichbare Knoten nur neu berechnen, wenn sich das Netz ändert. */
  private refresh(s: GameState): void {
    const key = `${s.edges.length}|${s.levels.rhizo}|${s.growth ? s.growth.to : -1}`;
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    const r = reach(s);
    const connected = s.nodes.filter((n) => n.connected);
    const sight = r * 1.7;
    this.visible = s.nodes.filter((n) => n.connected || connected.some((c) => Math.hypot(c.x - n.x, c.y - n.y) <= sight));
    this.reachable = new Set(this.visible.filter((n) => !n.connected && findSource(s, n.id)).map((n) => n.id));
  }

  isVisible(id: number): boolean {
    return this.visible.some((n) => n.id === id);
  }

  private updateCamera(s: GameState, dt: number): void {
    const pts = s.nodes.filter((n) => n.connected);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of pts) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const margin = reach(s) + 30;
    const hw = Math.max(200, (maxX - minX) / 2 + margin);
    const hh = Math.max(200, (maxY - minY) / 2 + margin);
    const target = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      scale: Math.min(this.w / (2 * hw), this.h / (2 * hh)),
    };
    if (!this.camReady) {
      this.cam = target;
      this.camReady = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 2.5);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
    this.cam.scale += (target.scale - this.cam.scale) * k;
  }

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.scale + this.w / 2, (y - this.cam.y) * this.cam.scale + this.h / 2];
  }

  /** Knoten unter einem Bildschirmpunkt (mit großzügiger Fingertoleranz). */
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

  addFloat(x: number, y: number, text: string): void {
    this.floats.push({ x, y, text, age: 0 });
    if (this.floats.length > 40) this.floats.shift();
    this.ripples.push({ x, y, age: 0 });
    if (this.ripples.length > 20) this.ripples.shift();
  }

  draw(s: GameState, dt: number, time: number): void {
    this.refresh(s);
    this.updateCamera(s, dt);
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#14110e';
    ctx.fillRect(0, 0, this.w, this.h);

    const sc = this.cam.scale;

    // Fäden
    ctx.lineCap = 'round';
    for (const e of s.edges) {
      const a = s.nodes[e.from];
      const b = s.nodes[e.to];
      if (!a || !b) continue;
      const [ax, ay] = this.toScreen(a.x, a.y);
      const [bx, by] = this.toScreen(b.x, b.y);
      ctx.strokeStyle = 'rgba(243,231,207,0.75)';
      ctx.lineWidth = Math.max(1.5, 3 * sc);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      // Nährstoffpuls Richtung Ursprung
      const len = Math.hypot(bx - ax, by - ay);
      const p = 1 - ((time * 60) / Math.max(len, 1) + e.to * 0.37) % 1;
      ctx.fillStyle = 'rgba(255,214,140,0.9)';
      ctx.beginPath();
      ctx.arc(ax + (bx - ax) * p, ay + (by - ay) * p, Math.max(1.5, 2.5 * sc), 0, Math.PI * 2);
      ctx.fill();
    }

    // wachsender Faden
    if (s.growth) {
      const a = s.nodes[s.growth.from];
      const b = s.nodes[s.growth.to];
      if (a && b) {
        const [ax, ay] = this.toScreen(a.x, a.y);
        const [bx, by] = this.toScreen(b.x, b.y);
        const f = Math.min(1, s.growth.progress / s.growth.length);
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(243,231,207,0.25)';
        ctx.lineWidth = Math.max(1, 2 * sc);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,224,170,1)';
        ctx.lineWidth = Math.max(1.5, 3 * sc);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
        ctx.stroke();
        const glow = 4 + Math.sin(time * 8) * 1.5;
        ctx.fillStyle = 'rgba(255,224,170,0.9)';
        ctx.beginPath();
        ctx.arc(ax + (bx - ax) * f, ay + (by - ay) * f, glow, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Knoten
    for (const n of this.visible) {
      const [x, y] = this.toScreen(n.x, n.y);
      const r = Math.max(4, n.r * sc);
      const depleted = n.type === 'totholz' && n.connected && n.stock <= 0;
      ctx.globalAlpha = n.connected ? 1 : n.type === 'stein' ? 0.75 : 0.4;
      ctx.fillStyle = depleted ? '#4a423a' : NODE_COLORS[n.type];
      ctx.beginPath();
      if (n.type === 'stein') {
        // Stein als Sechseck – auch ohne Farbe unterscheidbar
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.3;
          ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
      } else ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (this.reachable.has(n.id)) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(243,231,207,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (this.selected === n.id) {
        ctx.strokeStyle = '#ffd68c';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 8 + Math.sin(time * 5) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Tipp-Wellen und schwebende Zahlen
    for (const rp of this.ripples) {
      rp.age += dt;
      const a = 1 - rp.age / 0.5;
      if (a <= 0) continue;
      ctx.strokeStyle = `rgba(255,214,140,${a * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 6 + rp.age * 60, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.age < 0.5);
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      f.age += dt;
      const a = 1 - f.age / 0.9;
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,228,180,${a})`;
      ctx.fillText(f.text, f.x, f.y - 14 - f.age * 50);
    }
    this.floats = this.floats.filter((f) => f.age < 0.9);
  }
}
