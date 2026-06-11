import { describe, expect, it } from 'vitest';
import { createActor, setup, type AnyActorLogic } from 'xstate';
import { z } from 'zod';
import { matchActor } from './state-match';
import { typedSetup, noPayload } from './typed-machine';

// typedSetup を通さない素の XState マシン（STATE_TREE ブランド無し）。
// matchActor は StateSchemaFrom から状態名ツリーを導出してフォールバックする。
const plainAuthMachine = setup({
  types: {} as { events: { type: 'LOGIN' } | { type: 'LOGOUT' } | { type: 'GO_IDLE' } },
}).createMachine({
  id: 'plain-auth',
  initial: 'loggedOut',
  states: {
    loggedOut: { on: { LOGIN: 'loggedIn' } },
    loggedIn: {
      initial: 'active',
      states: { active: { on: { GO_IDLE: 'away' } }, away: {} },
      on: { LOGOUT: 'loggedOut' },
    },
  },
});

const fetchMachine = typedSetup({
  context: z.object({ retries: z.number() }),
  events: { FETCH: noPayload, RESOLVE: noPayload, CANCEL: noPayload, RETRY: noPayload },
}).createMachine({
  id: 'fetch',
  context: { retries: 0 },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: { on: { RESOLVE: 'success', CANCEL: 'idle' } },
    success: {},
  },
});

const authMachine = typedSetup({
  events: { LOGIN: noPayload, LOGOUT: noPayload, GO_IDLE: noPayload, WAKE_UP: noPayload },
}).createMachine({
  id: 'auth',
  initial: 'loggedOut',
  states: {
    loggedOut: { on: { LOGIN: 'loggedIn' } },
    loggedIn: {
      initial: 'active',
      states: {
        active: { on: { GO_IDLE: 'away' } },
        away: { on: { WAKE_UP: 'active' } },
      },
      on: { LOGOUT: 'loggedOut' },
    },
  },
});

// done() テスト用：type: 'final' の状態を持つマシン
const workflowMachine = typedSetup({
  context: z.object({ result: z.string() }),
  events: { START: noPayload, FINISH: noPayload },
}).createMachine({
  id: 'workflow',
  context: { result: 'none' },
  initial: 'pending',
  states: {
    pending: { on: { START: 'working' } },
    working: { on: { FINISH: 'completed' } },
    completed: { type: 'final' },
  },
});

// when() / fold() 用：context.retries を使うマシン
const retryMachine = typedSetup({
  context: z.object({ retries: z.number() }),
  events: { FETCH: noPayload, FAIL: noPayload, RETRY: noPayload },
}).createMachine({
  id: 'retry',
  context: { retries: 0 },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: {
      on: {
        FAIL: 'failed',
      },
    },
    failed: {
      on: { RETRY: 'loading' },
    },
  },
});

function start<M extends AnyActorLogic>(machine: M) {
  const actor = createActor(machine);
  actor.start();
  return actor;
}

describe('matchActor', () => {
  describe('in — case/when chain', () => {
    it('runs only the matching branch and sends a valid event', () => {
      const actor = start(fetchMachine);

      let ran = '';
      matchActor(actor)
        .in('idle', (idle) => {
          ran = idle.value;
          idle.send({ type: 'FETCH' }); // idle → loading
        })
        .in('loading', () => {
          ran += ':loading';
        });

      // chain 評価時は idle だったので loading 分岐は走らない
      expect(ran).toBe('idle');
      expect(actor.getSnapshot().value).toBe('loading');
    });

    it('matches loading after a transition and sends a state-valid event', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // → loading

      matchActor(actor).in('loading', (loading) => {
        loading.send({ type: 'RESOLVE' });
      });

      expect(actor.getSnapshot().value).toBe('success');
    });

    it('exposes context and value in scope', () => {
      const actor = start(fetchMachine);
      let seen: { value: string; retries: number } | null = null;

      matchActor(actor).in('idle', (idle) => {
        seen = { value: idle.value, retries: idle.context.retries };
      });

      expect(seen).toEqual({ value: 'idle', retries: 0 });
    });

    it('does not match a top-level state when in a different one (object value)', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // value = { loggedIn: 'active' }

      let ran = false;
      matchActor(actor).in('loggedOut', () => {
        ran = true;
      });

      expect(ran).toBe(false);
    });
  });

  describe('otherwise', () => {
    it('runs otherwise when no branch matched', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      let fellThrough = false;
      matchActor(actor)
        .in('idle', () => {
          throw new Error('should not run');
        })
        .in('success', () => {
          throw new Error('should not run');
        })
        .otherwise(() => {
          fellThrough = true;
        });

      expect(fellThrough).toBe(true);
    });

    it('does NOT run otherwise when a branch matched', () => {
      const actor = start(fetchMachine);

      let otherwiseRan = false;
      let idleRan = false;
      matchActor(actor)
        .in('idle', () => {
          idleRan = true;
        })
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(idleRan).toBe(true);
      expect(otherwiseRan).toBe(false);
    });
  });

  describe('nested states via within()', () => {
    it('descends into loggedIn.active and forwards a child event', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      matchActor(actor).within('loggedIn', (s) =>
        s.in('active', (active) => {
          ran = true;
          active.send({ type: 'GO_IDLE' });
        }),
      );

      expect(ran).toBe(true);
      expect(actor.getSnapshot().value).toEqual({ loggedIn: 'away' });
    });

    it('does not match a child when in a different child', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // active

      let awayRan = false;
      matchActor(actor).within('loggedIn', (s) =>
        s.in('away', () => {
          awayRan = true;
        }),
      );

      expect(awayRan).toBe(false);
    });

    it('returns to the top level after a within block (re-ascent)', () => {
      const actor = start(authMachine); // loggedOut

      let activeRan = false;
      let loggedOutRan = false;
      matchActor(actor)
        .within('loggedIn', (s) =>
          s.in('active', () => {
            activeRan = true; // 親非アクティブ → 走らない
          }),
        )
        .in('loggedOut', () => {
          loggedOutRan = true; // within を抜けてトップ兄弟へ戻れている
        });

      expect(activeRan).toBe(false);
      expect(loggedOutRan).toBe(true);
    });

    it('suppresses the inner otherwise when the parent is not active', () => {
      const actor = start(authMachine); // loggedOut

      let innerOtherwiseRan = false;
      matchActor(actor).within('loggedIn', (s) => {
        s.in('active', () => {}).otherwise(() => {
          innerOtherwiseRan = true;
        });
      });

      expect(innerOtherwiseRan).toBe(false);
    });

    it('runs the inner otherwise when the parent is active but no child matched', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let innerOtherwiseRan = false;
      matchActor(actor).within('loggedIn', (s) => {
        s.in('away', () => {}) // active なので一致しない
          .otherwise(() => {
            innerOtherwiseRan = true;
          });
      });

      expect(innerOtherwiseRan).toBe(true);
    });

    it('suppresses the outer otherwise when within matched the parent', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let outerOtherwiseRan = false;
      matchActor(actor)
        .within('loggedIn', (s) => s.in('active', () => {}))
        .otherwise(() => {
          outerOtherwiseRan = true;
        });

      expect(outerOtherwiseRan).toBe(false);
    });

    it('lets in() handle a compound parent state directly', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      matchActor(actor).in('loggedIn', (loggedIn) => {
        ran = true;
        loggedIn.send({ type: 'LOGOUT' });
      });

      expect(ran).toBe(true);
      expect(actor.getSnapshot().value).toBe('loggedOut');
    });
  });

  // typedSetup ブランドが無い素の setup マシンでも状態名が never に潰れず動く。
  describe('plain xstate setup machine (no typedSetup brand)', () => {
    it('in() matches a real top-level state name and sends', () => {
      const actor = start(plainAuthMachine);

      let ran = '';
      matchActor(actor)
        .in('loggedOut', (out) => {
          ran = out.value;
          out.send({ type: 'LOGIN' });
        })
        .in('loggedIn', () => {
          ran = 'loggedIn';
        });

      expect(ran).toBe('loggedOut');
      expect(actor.getSnapshot().value).toEqual({ loggedIn: 'active' });
    });

    it('within() descends into a compound state derived from the schema', () => {
      const actor = start(plainAuthMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      matchActor(actor).within('loggedIn', (s) =>
        s.in('active', (active) => {
          ran = true;
          active.send({ type: 'GO_IDLE' });
        }),
      );

      expect(ran).toBe(true);
      expect(actor.getSnapshot().value).toEqual({ loggedIn: 'away' });
    });

    it('re-ascends and runs otherwise on a plain machine', () => {
      const actor = start(plainAuthMachine); // loggedOut

      let activeRan = false;
      let otherwiseRan = false;
      matchActor(actor)
        .within('loggedIn', (s) =>
          s.in('active', () => {
            activeRan = true;
          }),
        )
        .in('loggedIn', () => {}) // 不一致
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(activeRan).toBe(false);
      expect(otherwiseRan).toBe(true);
    });
  });

  // ─── inAny ─────────────────────────────────────────────────────────────────

  describe('inAny — multi-state OR match', () => {
    it('runs callback when current state is one of the names', () => {
      const actor = start(fetchMachine); // idle

      let ran = false;
      matchActor(actor).inAny(['idle', 'success'], () => {
        ran = true;
      });

      expect(ran).toBe(true);
    });

    it('does not run when current state is none of the names', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      let ran = false;
      matchActor(actor).inAny(['idle', 'success'], () => {
        ran = true;
      });

      expect(ran).toBe(false);
    });

    it('exposes the matched state name and context in scope', () => {
      const actor = start(fetchMachine); // idle

      let seen: { value: string; retries: number } | null = null;
      matchActor(actor).inAny(['idle', 'loading'], (s) => {
        seen = { value: s.value, retries: s.context.retries };
      });

      expect(seen).toEqual({ value: 'idle', retries: 0 });
    });

    it('picks the first matching name when the list is ordered', () => {
      // idle と success の両方がリストにあるが、現在は idle のみがアクティブ。
      // idle が先に来ているので value は 'idle' になる。
      const actor = start(fetchMachine);

      const values: string[] = [];
      matchActor(actor).inAny(['success', 'idle'], (s) => {
        values.push(s.value);
      });

      // idle がマッチして一度だけ実行される
      expect(values).toEqual(['idle']);
    });

    it('suppresses otherwise when a name matched', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .inAny(['idle', 'success'], () => {})
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });

    it('runs otherwise when no name matched', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      let otherwiseRan = false;
      matchActor(actor)
        .inAny(['idle', 'success'], () => {})
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('chains with in() — both branches participate in matched tracking', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      let inAnyRan = false;
      let inRan = false;
      let otherwiseRan = false;
      matchActor(actor)
        .inAny(['idle', 'success'], () => {
          inAnyRan = true;
        })
        .in('loading', () => {
          inRan = true;
        })
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(inAnyRan).toBe(false);
      expect(inRan).toBe(true);
      expect(otherwiseRan).toBe(false);
    });

    it('matches compound parent state name (object value)', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // { loggedIn: 'active' }

      let seen = '';
      matchActor(actor).inAny(['loggedOut', 'loggedIn'], (s) => {
        seen = s.value;
      });

      expect(seen).toBe('loggedIn');
    });
  });

  // ─── when ──────────────────────────────────────────────────────────────────

  describe('when — context predicate match', () => {
    it('runs callback when guard returns true', () => {
      const actor = start(retryMachine);
      // retries は 0 だが、guard が常に true の場合
      let ran = false;
      matchActor(actor).when(
        () => true,
        () => {
          ran = true;
        },
      );

      expect(ran).toBe(true);
    });

    it('does not run when guard returns false', () => {
      const actor = start(retryMachine); // retries: 0

      let ran = false;
      matchActor(actor).when(
        (ctx) => ctx.retries > 3,
        () => {
          ran = true;
        },
      );

      expect(ran).toBe(false);
    });

    it('passes context to the guard and callback', () => {
      const actor = start(retryMachine); // retries: 0

      let guardSaw = -1;
      let cbSaw = -1;
      matchActor(actor).when(
        (ctx) => {
          guardSaw = ctx.retries;
          return true;
        },
        (ctx) => {
          cbSaw = ctx.retries;
        },
      );

      expect(guardSaw).toBe(0);
      expect(cbSaw).toBe(0);
    });

    it('suppresses otherwise when guard matched', () => {
      const actor = start(retryMachine);

      let otherwiseRan = false;
      matchActor(actor)
        .when(
          () => true,
          () => {},
        )
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });

    it('runs otherwise when guard never matched', () => {
      const actor = start(retryMachine); // retries: 0

      let otherwiseRan = false;
      matchActor(actor)
        .when(
          (ctx) => ctx.retries > 99,
          () => {},
        )
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('chains with in() — both can fire independently', () => {
      // idle かつ retries === 0: in('idle') と when(retries === 0) が両方走る
      const actor = start(retryMachine);

      let inRan = false;
      let whenRan = false;
      matchActor(actor)
        .in('idle', () => {
          inRan = true;
        })
        .when(
          (ctx) => ctx.retries === 0,
          () => {
            whenRan = true;
          },
        );

      expect(inRan).toBe(true);
      expect(whenRan).toBe(true);
    });

    it('when fires even if state branch did not match', () => {
      const actor = start(retryMachine);
      actor.send({ type: 'FETCH' }); // loading

      let idleRan = false;
      let whenRan = false;
      matchActor(actor)
        .in('idle', () => {
          idleRan = true;
        })
        .when(
          (ctx) => ctx.retries === 0,
          () => {
            whenRan = true;
          },
        );

      expect(idleRan).toBe(false);
      expect(whenRan).toBe(true);
    });
  });

  // ─── done ──────────────────────────────────────────────────────────────────

  describe('done — final state match', () => {
    it('does not run when machine is still active', () => {
      const actor = start(workflowMachine); // pending

      let ran = false;
      matchActor(actor).done(() => {
        ran = true;
      });

      expect(ran).toBe(false);
    });

    it('does not run in an intermediate state', () => {
      const actor = start(workflowMachine);
      actor.send({ type: 'START' }); // working

      let ran = false;
      matchActor(actor).done(() => {
        ran = true;
      });

      expect(ran).toBe(false);
    });

    it('runs when machine reaches a final state (snapshot.done === true)', () => {
      const actor = start(workflowMachine);
      actor.send({ type: 'START' });
      actor.send({ type: 'FINISH' }); // → completed (type: 'final')

      let ran = false;
      matchActor(actor).done(() => {
        ran = true;
      });

      expect(ran).toBe(true);
      expect(actor.getSnapshot().status).toBe('done');
    });

    it('passes context to the done callback', () => {
      const actor = start(workflowMachine);
      actor.send({ type: 'START' });
      actor.send({ type: 'FINISH' });

      let seen: string | null = null;
      matchActor(actor).done((ctx) => {
        seen = ctx.result;
      });

      expect(seen).toBe('none');
    });

    it('suppresses otherwise when done matched', () => {
      const actor = start(workflowMachine);
      actor.send({ type: 'START' });
      actor.send({ type: 'FINISH' });

      let otherwiseRan = false;
      matchActor(actor)
        .done(() => {})
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });

    it('runs otherwise when machine is not done', () => {
      const actor = start(workflowMachine); // pending

      let otherwiseRan = false;
      matchActor(actor)
        .done(() => {})
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('chains with in() — done suppresses outer otherwise', () => {
      const actor = start(workflowMachine);
      actor.send({ type: 'START' });
      actor.send({ type: 'FINISH' }); // completed (final)

      let inRan = false;
      let doneRan = false;
      let otherwiseRan = false;
      matchActor(actor)
        .in('pending', () => {
          inRan = true;
        })
        .done(() => {
          doneRan = true;
        })
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(inRan).toBe(false);
      expect(doneRan).toBe(true);
      expect(otherwiseRan).toBe(false);
    });
  });

  // ─── fold ──────────────────────────────────────────────────────────────────

  describe('fold — value-returning exhaustive pattern match', () => {
    it('returns the value from the matched state handler', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).fold({
        idle: () => 'ready',
        loading: () => 'busy',
        success: () => 'done',
      });

      expect(result).toBe('ready');
    });

    it('returns undefined when no case matches and no _ fallback', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).fold({
        idle: () => 'ready',
        // loading と success は未定義
      });

      expect(result).toBeUndefined();
    });

    it('returns _ fallback when no state case matches', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).fold({
        idle: () => 'ready',
        _: () => 'fallback',
      });

      expect(result).toBe('fallback');
    });

    it('does NOT call _ when a state case matches', () => {
      const actor = start(fetchMachine); // idle

      const calls: string[] = [];
      matchActor(actor).fold({
        idle: () => {
          calls.push('idle');
          return 'ready';
        },
        _: () => {
          calls.push('_');
          return 'fallback';
        },
      });

      expect(calls).toEqual(['idle']);
    });

    it('passes scope with context and value to the handler', () => {
      const actor = start(fetchMachine); // idle, retries: 0

      let seenValue = '';
      let seenRetries = -1;
      matchActor(actor).fold({
        idle: (s) => {
          seenValue = s.value;
          seenRetries = s.context.retries;
          return true;
        },
      });

      expect(seenValue).toBe('idle');
      expect(seenRetries).toBe(0);
    });

    it('returns different types depending on the match', () => {
      const actor = start(fetchMachine); // idle
      const asNumber = matchActor(actor).fold({
        idle: () => 42,
        loading: () => 99,
      });

      expect(asNumber).toBe(42);
    });

    it('only one handler runs even when multiple cases are present', () => {
      const actor = start(fetchMachine); // idle

      const ran: string[] = [];
      matchActor(actor).fold({
        idle: () => {
          ran.push('idle');
          return 1;
        },
        loading: () => {
          ran.push('loading');
          return 2;
        },
        success: () => {
          ran.push('success');
          return 3;
        },
      });

      expect(ran).toEqual(['idle']);
    });

    it('matches compound parent state name (object value)', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // { loggedIn: 'active' }

      const result = matchActor(actor).fold({
        loggedOut: () => 'out',
        loggedIn: () => 'in',
      });

      expect(result).toBe('in');
    });

    it('returns _ when only _ is provided (no state cases)', () => {
      const actor = start(fetchMachine);

      const result = matchActor(actor).fold({
        _: () => 'always',
      });

      expect(result).toBe('always');
    });

    it('can be used inside within() to derive a value from a child state', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let childResult: string | undefined;
      matchActor(actor).within('loggedIn', (child) => {
        childResult = child.fold({
          active: () => 'working',
          away: () => 'idle',
        });
      });

      expect(childResult).toBe('working');
    });

    it('fold inside within() returns undefined when child state does not match', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let childResult: string | undefined = 'sentinel';
      matchActor(actor).within('loggedIn', (child) => {
        childResult = child.fold({
          away: () => 'resting', // active なので一致しない
        });
      });

      expect(childResult).toBeUndefined();
    });
  });

  // ─── tapAlways ─────────────────────────────────────────────────────────────

  describe('tapAlways — FlatMap.flatTap: side-effect without touching matched', () => {
    it('always runs the callback regardless of state', () => {
      const actor = start(fetchMachine); // idle

      const calls: string[] = [];
      matchActor(actor)
        .tapAlways(() => calls.push('tap'))
        .in('loading', () => calls.push('loading')); // 不一致

      expect(calls).toEqual(['tap']);
    });

    it('runs before other branches in chain order', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const order: string[] = [];
      matchActor(actor)
        .tapAlways(() => order.push('tap'))
        .in('loading', () => order.push('in'));

      expect(order).toEqual(['tap', 'in']);
    });

    it('receives context', () => {
      const actor = start(fetchMachine); // retries: 0

      let seen = -1;
      matchActor(actor).tapAlways((ctx) => {
        seen = ctx.retries;
      });

      expect(seen).toBe(0);
    });

    it('does NOT set matched — otherwise still runs when no in() matched', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      let otherwiseRan = false;
      matchActor(actor)
        .tapAlways(() => {})  // 常に実行
        .in('idle', () => {}) // 不一致
        .otherwise(() => {
          otherwiseRan = true;
        });

      // tapAlways だけでは matched にならないため otherwise が発火する
      expect(otherwiseRan).toBe(true);
    });

    it('does NOT suppress otherwise even when tapAlways ran', () => {
      const actor = start(fetchMachine); // idle

      let tapRan = false;
      let otherwiseRan = false;
      matchActor(actor)
        .tapAlways(() => {
          tapRan = true;
        })
        .in('loading', () => {}) // 不一致
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(tapRan).toBe(true);
      expect(otherwiseRan).toBe(true);
    });

    it('is chainable — returns Matcher for further branching', () => {
      const actor = start(fetchMachine); // idle

      let inRan = false;
      matchActor(actor)
        .tapAlways(() => {})
        .in('idle', () => {
          inRan = true;
        });

      expect(inRan).toBe(true);
    });
  });

  // ─── mapContext ─────────────────────────────────────────────────────────────

  describe('mapContext — Functor / ReaderT.local: transform context for downstream', () => {
    it('transforms context visible to subsequent in() callbacks', () => {
      const actor = start(fetchMachine); // idle, retries: 0

      let seen = '';
      matchActor(actor)
        .mapContext((ctx) => ({ ...ctx, label: `retry:${ctx.retries}` }))
        .in('idle', (s) => {
          seen = s.context.label;
        });

      expect(seen).toBe('retry:0');
    });

    it('original context is unchanged for branches before mapContext', () => {
      const actor = start(fetchMachine);

      let beforeCtx: { retries: number } | null = null;
      let afterCtx: { retries: number; label: string } | null = null;

      matchActor(actor)
        .in('idle', (s) => {
          beforeCtx = { retries: s.context.retries };
        })
        .mapContext((ctx) => ({ ...ctx, label: 'added' }))
        .in('idle', (s) => {
          afterCtx = { retries: s.context.retries, label: s.context.label };
        });

      expect(beforeCtx).toEqual({ retries: 0 });
      expect(afterCtx).toEqual({ retries: 0, label: 'added' });
    });

    it('shares matched ref — in() on mapped matcher suppresses otherwise', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .mapContext((ctx) => ctx)
        .in('idle', () => {})
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });

    it('shares matched ref — otherwise fires if mapped in() did not match', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .mapContext((ctx) => ctx)
        .in('loading', () => {}) // 不一致
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('can transform context type entirely (different shape)', () => {
      const actor = start(fetchMachine);

      let seen = -1;
      matchActor(actor)
        .mapContext((ctx) => ctx.retries * 10) // { retries: number } → number
        .in('idle', (s) => {
          seen = s.context; // number になっている
        });

      expect(seen).toBe(0);
    });

    it('can chain multiple mapContext calls', () => {
      const actor = start(fetchMachine);

      let seen = '';
      matchActor(actor)
        .mapContext((ctx) => ({ ...ctx, step: 1 }))
        .mapContext((ctx) => ({ ...ctx, step: ctx.step + 1 }))
        .in('idle', (s) => {
          seen = String(s.context.step);
        });

      expect(seen).toBe('2');
    });
  });

  // ─── collect ───────────────────────────────────────────────────────────────

  describe('collect — Foldable.toList: gather all matching values into an array', () => {
    it('returns single-element array when one case matches', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).collect({
        idle: () => 'ready',
        loading: () => 'busy',
      });

      expect(result).toEqual(['ready']);
    });

    it('returns empty array when no case matches', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).collect({
        idle: () => 'ready',
        success: () => 'done',
      });

      expect(result).toEqual([]);
    });

    it('passes scope with context and value to each handler', () => {
      const actor = start(fetchMachine); // idle, retries: 0

      const result = matchActor(actor).collect({
        idle: (s) => `${s.value}:${s.context.retries}`,
      });

      expect(result).toEqual(['idle:0']);
    });

    it('collects MULTIPLE matches for parallel (compound) states', () => {
      // XState parallel state: { audio: 'on', display: 'windowed' } at root
      const parallelMachine = setup({
        types: {} as {
          events:
            | { type: 'MUTE' }
            | { type: 'UNMUTE' }
            | { type: 'FULLSCREEN' }
            | { type: 'EXIT_FULLSCREEN' };
        },
      }).createMachine({
        id: 'player',
        type: 'parallel',
        states: {
          audio: {
            initial: 'on',
            states: {
              on: { on: { MUTE: 'off' } },
              off: { on: { UNMUTE: 'on' } },
            },
          },
          display: {
            initial: 'windowed',
            states: {
              windowed: { on: { FULLSCREEN: 'fullscreen' } },
              fullscreen: { on: { EXIT_FULLSCREEN: 'windowed' } },
            },
          },
        },
      });

      const actor = start(parallelMachine);
      // state = { audio: 'on', display: 'windowed' } — 並列で両方アクティブ

      const result = matchActor(actor).collect({
        audio: (s) => `audio:${s.value}`,
        display: (s) => `display:${s.value}`,
      });

      // 両サブマシンが同時にアクティブ → 両ケースを収集
      expect(result).toEqual(['audio:audio', 'display:display']);
    });

    it('only collects cases that match — non-matching keys are skipped', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).collect({
        idle: () => 'idle',
        loading: () => 'loading',
        success: () => 'success',
      });

      expect(result).toEqual(['idle']); // idle だけ一致
    });

    it('does not affect matched flag (does not suppress otherwise)', () => {
      // collect は値抽出専用。matched を変えないので otherwise への影響なし
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      let otherwiseRan = false;
      matchActor(actor)
        .in('idle', () => {}) // 不一致
        .otherwise(() => {
          otherwiseRan = true;
        });

      // collect だけでは matched は立たない（in/when/inAny が必要）
      matchActor(actor).collect({ loading: () => 1 }); // collect は matched に影響しない

      expect(otherwiseRan).toBe(true);
    });

    it('works inside within() for nested state collection', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let result: string[] = [];
      matchActor(actor).within('loggedIn', (child) => {
        result = child.collect({
          active: (s) => `active:${s.value}`,
          away: (s) => `away:${s.value}`,
        });
      });

      expect(result).toEqual(['active:active']);
    });
  });

  // ─── foldMap ───────────────────────────────────────────────────────────────

  describe('foldMap — Foldable.foldMap: fold all matches with a Monoid', () => {
    it('returns the combined value when one case matches', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).foldMap(
        { empty: '', combine: (a, b) => (a ? `${a} | ${b}` : b) },
        {
          idle: () => 'idle',
          loading: () => 'loading',
        },
      );

      expect(result).toBe('idle');
    });

    it('returns monoid.empty when no case matches', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).foldMap(
        { empty: 'EMPTY', combine: (a, b) => `${a}+${b}` },
        { idle: () => 'idle', success: () => 'success' },
      );

      expect(result).toBe('EMPTY');
    });

    it('combines multiple matches with monoid.combine (parallel states)', () => {
      const parallelMachine = setup({
        types: {} as {
          events: { type: 'MUTE' } | { type: 'FULLSCREEN' };
        },
      }).createMachine({
        id: 'player2',
        type: 'parallel',
        states: {
          audio: {
            initial: 'on',
            states: { on: { on: { MUTE: 'off' } }, off: {} },
          },
          display: {
            initial: 'windowed',
            states: { windowed: { on: { FULLSCREEN: 'fullscreen' } }, fullscreen: {} },
          },
        },
      });

      const actor = start(parallelMachine);
      // { audio: 'on', display: 'windowed' }

      const result = matchActor(actor).foldMap(
        { empty: 0, combine: (a, b) => a + b },
        {
          audio: () => 1,
          display: () => 10,
        },
      );

      // 1 + 10 = 11（両サブマシンが一致）
      expect(result).toBe(11);
    });

    it('is left-associative: combine(combine(empty, first), second)', () => {
      const parallelMachine = setup({
        types: {} as { events: { type: 'X' } },
      }).createMachine({
        id: 'acc',
        type: 'parallel',
        states: {
          a: { initial: 'on', states: { on: {} } },
          b: { initial: 'on', states: { on: {} } },
          c: { initial: 'on', states: { on: {} } },
        },
      });

      const actor = start(parallelMachine);
      const calls: string[] = [];

      matchActor(actor).foldMap(
        {
          empty: 'E',
          combine: (a, b) => {
            calls.push(`combine(${a},${b})`);
            return `(${a}+${b})`;
          },
        },
        {
          a: () => 'A',
          b: () => 'B',
          c: () => 'C',
        },
      );

      // E→A, (E+A)→B, ((E+A)+B)→C の左結合
      expect(calls).toEqual(['combine(E,A)', 'combine((E+A),B)', 'combine(((E+A)+B),C)']);
    });

    it('works as a string-concatenation monoid (practical use case)', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).foldMap(
        { empty: [] as string[], combine: (a, b) => [...a, b] },
        {
          idle: () => 'idle-active',
          loading: () => 'loading-active',
          success: () => 'success-active',
        },
      );

      expect(result).toEqual(['idle-active']);
    });

    it('works inside within() for nested state aggregation', () => {
      const actor = start(authMachine);
      actor.send({ type: 'LOGIN' }); // loggedIn.active

      let result = '';
      matchActor(actor).within('loggedIn', (child) => {
        // 文字列連結モノイド: empty='' で始まり、combine は空文字を無視して連結
        result = child.foldMap(
          { empty: '', combine: (a, b) => (a ? `${a},${b}` : b) },
          {
            active: () => 'active',
            away: () => 'away',
          },
        );
      });

      // active だけ一致 → '' を空文字として combine → 'active'
      expect(result).toBe('active');
    });
  });

  // ─── pipe ──────────────────────────────────────────────────────────────────

  describe('pipe — Kleisli composition: thread Matcher through transform functions', () => {
    it('applies a single transform function', () => {
      const actor = start(fetchMachine); // idle

      let ran = false;
      matchActor(actor).pipe((m) =>
        m.in('idle', () => {
          ran = true;
        }),
      );

      expect(ran).toBe(true);
    });

    it('chains two transforms in order', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const order: string[] = [];
      matchActor(actor).pipe(
        (m) => m.tapAlways(() => order.push('tap')),
        (m) =>
          m.in('loading', () => {
            order.push('loading');
          }),
      );

      expect(order).toEqual(['tap', 'loading']);
    });

    it('applies three transforms maintaining matched state', () => {
      const actor = start(fetchMachine); // idle

      let idleRan = false;
      let otherwiseRan = false;
      matchActor(actor)
        .pipe(
          (m) => m.tapAlways(() => {}),
          (m) => m.tapAlways(() => {}),
          (m) => m.in('idle', () => { idleRan = true; }),
        )
        .otherwise(() => { otherwiseRan = true; });

      expect(idleRan).toBe(true);
      expect(otherwiseRan).toBe(false);
    });

    it('can compose reusable behavior modules (Kleisli pattern)', () => {
      type M = typeof matchActor<typeof fetchMachine>;
      const withLoadingLog = (m: ReturnType<M>) =>
        m.inAny(['loading', 'success'], () => loadingCalls.push('seen'));
      const withIdleReset = (m: ReturnType<M>) =>
        m.in('idle', () => idleCalls.push('idle'));

      const loadingCalls: string[] = [];
      const idleCalls: string[] = [];

      const actor = start(fetchMachine); // idle
      matchActor(actor).pipe(withLoadingLog, withIdleReset);

      expect(loadingCalls).toEqual([]); // idle なので loading は発火しない
      expect(idleCalls).toEqual(['idle']);
    });

    it('pipe terminal: last function can return a non-Matcher value', () => {
      const actor = start(fetchMachine); // idle

      const label = matchActor(actor).pipe((m) =>
        m.fold({
          idle: () => 'ready',
          loading: () => 'busy',
          _: () => 'unknown',
        }),
      );

      expect(label).toBe('ready');
    });

    it('pipe with 4 transforms applies all in order', () => {
      const actor = start(fetchMachine);

      const steps: number[] = [];
      matchActor(actor).pipe(
        (m) => { steps.push(1); return m; },
        (m) => { steps.push(2); return m; },
        (m) => { steps.push(3); return m; },
        (m) => { steps.push(4); return m; },
      );

      expect(steps).toEqual([1, 2, 3, 4]);
    });
  });
});
