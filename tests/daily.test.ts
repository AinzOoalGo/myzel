import { describe, expect, it } from 'bun:test';
import { claimQuest, dayKey, makeQuests, questDone, rollDaily } from '../src/core/daily';
import { buy, catchGolden, newGame, prestige, startGrowth, simulate, findSource, tap } from '../src/core/game';
import { deserialize, serialize } from '../src/core/save';
import { CONFIG } from '../src/core/config';

describe('Tägliche Aufgaben', () => {
  it('drei verschiedene Aufgaben pro Tag, gleich für denselben Tag', () => {
    const a = makeQuests('2026-10-29', 1);
    expect(a.length).toBe(3);
    expect(makeQuests('2026-10-29', 1)).toEqual(a);
    expect(new Set(a.map((q) => q.kind + (q.nodeType ?? ''))).size).toBe(3);
  });
  it('Zone-3-Aufgaben erscheinen nur ab Zone 3', () => {
    for (let d = 1; d <= 28; d++) {
      for (const q of makeQuests(`2026-02-${String(d).padStart(2, '0')}`, 1)) expect(['moor', 'mineral', 'altbaum']).not.toContain(q.nodeType);
    }
  });
  it('neuer Tag = neue Aufgaben, gleicher Tag = keine Änderung', () => {
    const s = newGame(1);
    expect(rollDaily(s, '2026-10-29')).toBe(true);
    s.meta.daily.quests[0]!.progress = 1;
    expect(rollDaily(s, '2026-10-29')).toBe(false);
    expect(s.meta.daily.quests[0]!.progress).toBe(1);
    expect(rollDaily(s, '2026-10-30')).toBe(true);
  });
  it('Fortschritt zählt bei den passenden Aktionen', () => {
    const s = newGame(1);
    s.meta.daily = { day: 'x', streak: 0, lastCompleteDay: null, quests: [
      { kind: 'taps', target: 3, progress: 0, claimed: false },
      { kind: 'connect', target: 1, progress: 0, claimed: false },
      { kind: 'buy', target: 1, progress: 0, claimed: false },
    ] };
    for (let i = 0; i < 5; i++) tap(s);
    s.res.n = 1e9;
    buy(s, 'hyphen');
    const t = s.nodes.find((n) => findSource(s, n.id))!;
    startGrowth(s, t.id);
    simulate(s, 300, 0.5);
    expect(s.meta.daily.quests.every(questDone)).toBe(true);
    expect(s.meta.daily.quests[0]!.progress).toBe(3); // nie über das Ziel
  });
  it('Abholen gibt Sporen genau einmal, alle drei erhöhen die Serie', () => {
    const s = newGame(1);
    rollDaily(s, '2026-10-29');
    for (const q of s.meta.daily.quests) q.progress = q.target;
    const before = s.meta.spores;
    const r0 = claimQuest(s, 0);
    expect(r0).toBeGreaterThan(0);
    expect(claimQuest(s, 0)).toBe(0);
    claimQuest(s, 1);
    const r2 = claimQuest(s, 2);
    expect(r2).toBeGreaterThan(r0); // Serienbonus
    expect(s.meta.daily.streak).toBe(1);
    expect(s.meta.spores).toBeGreaterThan(before);
  });
  it('unfertige Aufgaben lassen sich nicht abholen', () => {
    const s = newGame(1);
    rollDaily(s, '2026-10-29');
    expect(claimQuest(s, 0)).toBe(0);
  });
  it('Serie bricht nach einem verpassten Tag', () => {
    const s = newGame(1);
    rollDaily(s, '2026-10-29');
    s.meta.daily.streak = 4;
    s.meta.daily.lastCompleteDay = '2026-10-29';
    rollDaily(s, '2026-10-30');
    expect(s.meta.daily.streak).toBe(4);
    rollDaily(s, '2026-11-02');
    expect(s.meta.daily.streak).toBe(0);
  });
  it('Aufgaben überleben Sporenflug und Speichern, Sporenflug zählt mit', () => {
    const s = newGame(1);
    s.meta.daily = { day: '2026-10-29', streak: 2, lastCompleteDay: null, quests: [{ kind: 'prestige', target: 1, progress: 0, claimed: false }] };
    s.nodes.filter((n) => n.zone === 1 && n.type !== 'stein').slice(1, CONFIG.prestige.minNodes + 1).forEach((n) => (n.connected = true));
    s.stats.totalN = 1e7;
    const next = prestige(s, 2)!;
    expect(next.meta.daily.quests[0]!.progress).toBe(1);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(next, 0))));
    expect(back.meta.daily).toEqual(next.meta.daily);
  });
  it('goldener Fruchtkörper zählt', () => {
    const s = newGame(1);
    s.meta.daily = { day: 'x', streak: 0, lastCompleteDay: null, quests: [{ kind: 'gold', target: 1, progress: 0, claimed: false }] };
    s.events.golden = { x: 0, y: 0, until: 1e9 };
    catchGolden(s);
    expect(questDone(s.meta.daily.quests[0]!)).toBe(true);
  });
  it('dayKey nutzt Ortszeit', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
