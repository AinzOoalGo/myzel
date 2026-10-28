import { describe, expect, it } from 'bun:test';
import { CONFIG } from '../src/core/config';
import { newGame, prestige } from '../src/core/game';
import { deserialize, serialize } from '../src/core/save';
import { trackActive, trackOffline, trackSession } from '../src/core/tracking';

const readyToFly = () => {
  const s = newGame(1);
  s.nodes.filter((n) => n.zone === 1 && n.type !== 'stein').slice(1, CONFIG.prestige.minNodes + 1).forEach((n) => (n.connected = true));
  s.stats.totalN = 1e7;
  s.stats.playSeconds = 1800;
  s.stats.zoneDoneAt = 1200;
  return s;
};

describe('Statistik', () => {
  it('zählt echte Zeit, Testzeit und Offline-Zeit getrennt', () => {
    const s = newGame(1);
    trackActive(s.meta.track, 60, 1);
    trackActive(s.meta.track, 30, 10);
    trackOffline(s.meta.track, 3600);
    expect(s.meta.track.realActive).toBe(90);
    expect(s.meta.track.testReal).toBe(30);
    expect(s.meta.track.offline).toBe(3600);
    expect(s.meta.track.run.realActive).toBe(90);
  });
  it('Sporenflug legt einen Durchlauf in der Historie ab und startet neu', () => {
    const s = readyToFly();
    s.meta.track.run.startedAt = 1000;
    trackActive(s.meta.track, 600, 1);
    const next = prestige(s, 2, 5000)!;
    const h = next.meta.track.history;
    expect(h.length).toBe(1);
    expect(h[0]!.n).toBe(1);
    expect(h[0]!.realSec).toBe(600);
    expect(h[0]!.playSec).toBe(1800);
    expect(h[0]!.zone1DoneAt).toBe(1200);
    expect(h[0]!.spores).toBeGreaterThan(0);
    expect(next.meta.track.run.startedAt).toBe(5000);
    expect(next.meta.track.run.realActive).toBe(0);
    expect(next.meta.track.realActive).toBe(600); // Gesamtzeit bleibt
  });
  it('Sitzungen: höchstens 50 Längen gespeichert', () => {
    const s = newGame(1);
    for (let i = 0; i < 60; i++) trackSession(s.meta.track, i * 10);
    expect(s.meta.track.sessions).toBe(60);
    expect(s.meta.track.sessionLens.length).toBe(50);
  });
  it('wird gespeichert und geladen', () => {
    const s = readyToFly();
    trackActive(s.meta.track, 100, 5);
    const next = prestige(s, 2, 9999)!;
    expect(deserialize(JSON.parse(JSON.stringify(serialize(next, 0)))).meta.track).toEqual(next.meta.track);
  });
});
