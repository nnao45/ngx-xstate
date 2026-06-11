import { createActor, createMachine, setup } from 'xstate';
import { describe, expect, it } from 'vitest';
import { inspect } from './inspect';

// ─── テスト用マシン ────────────────────────────────────────────────────────────

/** シンプルな auth マシン（ネスト + final あり） */
const authMachine = createMachine({
  id: 'auth',
  initial: 'loggedOut',
  states: {
    loggedOut: {
      on: { LOGIN: 'loggedIn' },
    },
    loggedIn: {
      initial: 'active',
      states: {
        active: { on: { GO_IDLE: 'idle' } },
        idle: { on: { WAKE_UP: 'active' } },
      },
      on: { LOGOUT: 'loggedOut' },
    },
    closed: { type: 'final' },
  },
});

/** サイクルあり + ガードあり */
const guardedMachine = setup({
  guards: {
    isValid: ({ context }: { context: { ok: boolean } }) => context.ok,
  },
}).createMachine({
  initial: 'idle',
  context: { ok: false },
  states: {
    idle: {
      on: {
        SUBMIT: { target: 'processing', guard: 'isValid' },
        RESET: 'idle', // 自己ループ
      },
    },
    processing: {
      on: { DONE: 'done', FAIL: 'idle' },
    },
    done: { type: 'final' },
  },
});

/** 孤立状態あり（到達不能） */
const isolatedMachine = createMachine({
  initial: 'a',
  states: {
    a: { on: { GO: 'b' } },
    b: { type: 'final' },
    orphan: { on: { X: 'a' } }, // 到達不能
  },
});

// ─── states() ─────────────────────────────────────────────────────────────────

describe('inspect.states()', () => {
  it('returns all state names including nested', () => {
    const ins = inspect(authMachine);
    const states = ins.states();
    expect(states).toContain('loggedOut');
    expect(states).toContain('loggedIn');
    expect(states).toContain('loggedIn.active');
    expect(states).toContain('loggedIn.idle');
    expect(states).toContain('closed');
  });

  it('does not include the root machine node', () => {
    const ins = inspect(authMachine);
    expect(ins.states()).not.toContain('auth');
    expect(ins.states()).not.toContain('');
  });
});

// ─── events() ────────────────────────────────────────────────────────────────

describe('inspect.events()', () => {
  it('returns all event types defined in the machine', () => {
    const ins = inspect(authMachine);
    const events = ins.events();
    expect(events).toContain('LOGIN');
    expect(events).toContain('LOGOUT');
    expect(events).toContain('GO_IDLE');
    expect(events).toContain('WAKE_UP');
  });
});

// ─── allowedEvents() ──────────────────────────────────────────────────────────

describe('inspect.allowedEvents()', () => {
  it('returns events defined directly on that state', () => {
    const ins = inspect(authMachine);
    expect(ins.allowedEvents('loggedOut')).toContain('LOGIN');
  });

  it('includes parent-level events for nested states', () => {
    const ins = inspect(authMachine);
    const allowed = ins.allowedEvents('loggedIn.active');
    expect(allowed).toContain('GO_IDLE');   // own
    expect(allowed).toContain('LOGOUT');    // inherited from loggedIn
  });

  it('does not include events from unrelated states', () => {
    const ins = inspect(authMachine);
    expect(ins.allowedEvents('loggedOut')).not.toContain('LOGOUT');
  });
});

// ─── transitionsFrom() ────────────────────────────────────────────────────────

describe('inspect.transitionsFrom()', () => {
  it('returns transitions from a state', () => {
    const ins = inspect(authMachine);
    const ts = ins.transitionsFrom('loggedOut');
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ event: 'LOGIN', source: 'loggedOut', target: 'loggedIn' });
  });

  it('returns empty array for state with no outgoing transitions', () => {
    const ins = inspect(authMachine);
    expect(ins.transitionsFrom('closed')).toEqual([]);
  });

  it('includes guard info when present', () => {
    const ins = inspect(guardedMachine);
    const ts = ins.transitionsFrom('idle');
    const submit = ts.find((t) => t.event === 'SUBMIT');
    expect(submit?.guard).toBeDefined();
  });
});

// ─── targetsFrom() ───────────────────────────────────────────────────────────

describe('inspect.targetsFrom()', () => {
  it('returns target states for state + event', () => {
    const ins = inspect(authMachine);
    expect(ins.targetsFrom('loggedOut', 'LOGIN')).toEqual(['loggedIn']);
  });

  it('returns empty for undefined event', () => {
    const ins = inspect(authMachine);
    expect(ins.targetsFrom('loggedOut', 'LOGOUT' as 'LOGIN')).toEqual([]);
  });
});

// ─── terminalStates() ────────────────────────────────────────────────────────

describe('inspect.terminalStates()', () => {
  it('returns only final states', () => {
    const ins = inspect(authMachine);
    expect(ins.terminalStates()).toEqual(['closed']);
  });

  it('includes all final states', () => {
    const ins = inspect(guardedMachine);
    expect(ins.terminalStates()).toEqual(['done']);
  });
});

// ─── canReach() ──────────────────────────────────────────────────────────────

describe('inspect.canReach()', () => {
  it('returns true for reachable states', () => {
    const ins = inspect(authMachine);
    expect(ins.canReach('loggedIn')).toBe(true);
    expect(ins.canReach('loggedIn.active')).toBe(true);
    expect(ins.canReach('closed')).toBe(false); // no path to closed in authMachine
  });

  it('returns false for orphan states', () => {
    const ins = inspect(isolatedMachine);
    expect(ins.canReach('orphan')).toBe(false);
  });

  it('returns true for initial state', () => {
    const ins = inspect(authMachine);
    expect(ins.canReach('loggedOut')).toBe(true);
  });
});

// ─── unreachableStates() ─────────────────────────────────────────────────────

describe('inspect.unreachableStates()', () => {
  it('returns states not reachable from initial', () => {
    const ins = inspect(isolatedMachine);
    expect(ins.unreachableStates()).toContain('orphan');
  });

  it('returns empty when all states are reachable', () => {
    const ins = inspect(guardedMachine);
    // idle -> processing -> done, idle self-loop
    // all states reachable
    expect(ins.unreachableStates()).toEqual([]);
  });
});

// ─── nonTerminalSinks() ──────────────────────────────────────────────────────

describe('inspect.nonTerminalSinks()', () => {
  it('returns non-final states with no outgoing transitions', () => {
    const stuck = createMachine({
      initial: 'a',
      states: {
        a: { on: { GO: 'b' } },
        b: {}, // not final, no transitions → sink
      },
    });
    const ins = inspect(stuck);
    expect(ins.nonTerminalSinks()).toContain('b');
  });

  it('does not include final states', () => {
    const ins = inspect(authMachine);
    // closed is final, so not included
    expect(ins.nonTerminalSinks()).not.toContain('closed');
  });
});

// ─── cycles() / hasCycle() ───────────────────────────────────────────────────

describe('inspect.cycles()', () => {
  it('detects multi-state cycle', () => {
    const ins = inspect(authMachine);
    const cycles = ins.cycles();
    // loggedOut → loggedIn → loggedOut is a cycle
    const cycleStates = cycles.flat();
    expect(cycleStates).toContain('loggedOut');
    expect(cycleStates).toContain('loggedIn');
  });

  it('detects self-loop', () => {
    const ins = inspect(guardedMachine);
    const cycles = ins.cycles();
    const cycleStates = cycles.flat();
    expect(cycleStates).toContain('idle'); // idle RESET → idle
  });

  it('returns empty for pure DAG', () => {
    const dag = createMachine({
      initial: 'a',
      states: {
        a: { on: { GO: 'b' } },
        b: { on: { GO: 'c' } },
        c: { type: 'final' },
      },
    });
    expect(inspect(dag).cycles()).toEqual([]);
  });
});

describe('inspect.hasCycle()', () => {
  it('returns true for states in a cycle', () => {
    const ins = inspect(authMachine);
    expect(ins.hasCycle('loggedOut')).toBe(true);
    expect(ins.hasCycle('loggedIn')).toBe(true);
  });

  it('returns false for states not in any cycle', () => {
    const ins = inspect(authMachine);
    expect(ins.hasCycle('closed')).toBe(false);
  });

  it('returns true for self-loop state', () => {
    const ins = inspect(guardedMachine);
    expect(ins.hasCycle('idle')).toBe(true);
  });
});

// ─── shortestPath() ──────────────────────────────────────────────────────────

describe('inspect.shortestPath()', () => {
  it('finds shortest path between two states', () => {
    const ins = inspect(authMachine);
    const path = ins.shortestPath('loggedOut', 'loggedIn.active');
    expect(path).not.toBeNull();
    if (path === null) return;
    expect(path[0]).toBe('loggedOut');
    expect(path[path.length - 1]).toBe('loggedIn.active');
  });

  it('returns single-element array for same state', () => {
    const ins = inspect(authMachine);
    expect(ins.shortestPath('loggedOut', 'loggedOut')).toEqual(['loggedOut']);
  });

  it('returns null for unreachable target', () => {
    const ins = inspect(isolatedMachine);
    expect(ins.shortestPath('a', 'orphan')).toBeNull();
  });
});

// ─── stateDistance() ─────────────────────────────────────────────────────────

describe('inspect.stateDistance()', () => {
  it('returns 0 for same state', () => {
    expect(inspect(authMachine).stateDistance('loggedOut', 'loggedOut')).toBe(0);
  });

  it('returns correct distance', () => {
    const ins = inspect(authMachine);
    // LOGIN from loggedOut enters loggedIn.active in 1 event (compound init is automatic)
    expect(ins.stateDistance('loggedOut', 'loggedIn.active')).toBe(1);
    // loggedIn.active → loggedIn.idle via GO_IDLE
    expect(ins.stateDistance('loggedIn.active', 'loggedIn.idle')).toBe(1);
  });

  it('returns -1 for unreachable', () => {
    expect(inspect(isolatedMachine).stateDistance('a', 'orphan')).toBe(-1);
  });
});

// ─── allPaths() ──────────────────────────────────────────────────────────────

describe('inspect.allPaths()', () => {
  it('returns paths from initial state', () => {
    const ins = inspect(isolatedMachine);
    const paths = ins.allPaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p.states[0]).toBe('a');
    }
  });

  it('each path has events.length === states.length - 1', () => {
    const ins = inspect(authMachine);
    const paths = ins.allPaths({ maxDepth: 5 });
    for (const p of paths) {
      expect(p.events.length).toBe(p.states.length - 1);
    }
  });

  it('respects maxDepth', () => {
    const ins = inspect(authMachine);
    const paths = ins.allPaths({ maxDepth: 2 });
    for (const p of paths) {
      expect(p.events.length).toBeLessThanOrEqual(2);
    }
  });
});

// ─── canSend() ───────────────────────────────────────────────────────────────

describe('inspect.canSend()', () => {
  it('returns true for a sendable event', () => {
    const actor = createActor(authMachine).start();
    const snap = actor.getSnapshot();
    expect(inspect(authMachine).canSend(snap, 'LOGIN')).toBe(true);
  });

  it('returns false for an event not applicable in current state', () => {
    const actor = createActor(authMachine).start();
    const snap = actor.getSnapshot();
    expect(inspect(authMachine).canSend(snap, 'LOGOUT')).toBe(false);
  });

  it('returns false when guard blocks the event', () => {
    const actor = createActor(guardedMachine).start();
    const snap = actor.getSnapshot();
    // context.ok is false → SUBMIT is blocked
    expect(inspect(guardedMachine).canSend(snap, 'SUBMIT')).toBe(false);
  });

  it('returns true when guard passes', () => {
    const actor = createActor(guardedMachine).start();
    actor.send({ type: 'RESET' }); // stay in idle
    // Snapshot has ok: false → guard blocks
    // Let's use a machine where guard allows
    const okMachine = setup({
      guards: { isValid: () => true },
    }).createMachine({
      initial: 'idle',
      context: { ok: true },
      states: {
        idle: { on: { SUBMIT: { target: 'done', guard: 'isValid' } } },
        done: { type: 'final' },
      },
    });
    const okActor = createActor(okMachine).start();
    expect(inspect(okMachine).canSend(okActor.getSnapshot(), 'SUBMIT')).toBe(true);
  });
});

// ─── nextStates() ────────────────────────────────────────────────────────────

describe('inspect.nextStates()', () => {
  it('returns the next active state(s) after sending an event', () => {
    const actor = createActor(authMachine).start();
    const snap = actor.getSnapshot();
    const next = inspect(authMachine).nextStates(snap, { type: 'LOGIN' });
    expect(next).toContain('loggedIn.active');
  });

  it('returns current state if event causes no transition', () => {
    const actor = createActor(guardedMachine).start();
    const snap = actor.getSnapshot();
    // SUBMIT blocked by guard → stays in idle
    const next = inspect(guardedMachine).nextStates(snap, { type: 'SUBMIT' });
    expect(next).toContain('idle');
  });
});

// ─── enabledTransitions() / blockedTransitions() ─────────────────────────────

describe('inspect.enabledTransitions()', () => {
  it('returns transitions that can fire', () => {
    const actor = createActor(authMachine).start();
    const snap = actor.getSnapshot();
    const enabled = inspect(authMachine).enabledTransitions(snap);
    expect(enabled.map((t) => t.event)).toContain('LOGIN');
  });

  it('does not include guard-blocked transitions', () => {
    const actor = createActor(guardedMachine).start();
    const snap = actor.getSnapshot();
    const enabled = inspect(guardedMachine).enabledTransitions(snap);
    expect(enabled.map((t) => t.event)).not.toContain('SUBMIT');
  });
});

describe('inspect.blockedTransitions()', () => {
  it('returns guard-blocked transitions', () => {
    const actor = createActor(guardedMachine).start();
    const snap = actor.getSnapshot();
    const blocked = inspect(guardedMachine).blockedTransitions(snap);
    expect(blocked.map((t) => t.event)).toContain('SUBMIT');
  });

  it('returns empty when nothing is blocked', () => {
    const actor = createActor(authMachine).start();
    const snap = actor.getSnapshot();
    const blocked = inspect(authMachine).blockedTransitions(snap);
    // authMachine has no guards
    expect(blocked).toEqual([]);
  });
});

// ─── explainBlocked() ────────────────────────────────────────────────────────

describe('inspect.explainBlocked()', () => {
  it('explains that no transition is defined', () => {
    const actor = createActor(authMachine).start();
    const snap = actor.getSnapshot();
    const msg = inspect(authMachine).explainBlocked(snap, 'LOGOUT' as 'LOGIN');
    expect(msg).toMatch(/no transition defined/iu);
    expect(msg).toContain('LOGOUT');
  });

  it('explains that a guard blocked the event', () => {
    const actor = createActor(guardedMachine).start();
    const snap = actor.getSnapshot();
    const msg = inspect(guardedMachine).explainBlocked(snap, 'SUBMIT');
    expect(msg).toMatch(/blocked by guard/iu);
  });

  it('returns enabled message when event is not actually blocked', () => {
    const actor = createActor(authMachine).start();
    const snap = actor.getSnapshot();
    const msg = inspect(authMachine).explainBlocked(snap, 'LOGIN');
    expect(msg).toMatch(/enabled/iu);
  });
});
