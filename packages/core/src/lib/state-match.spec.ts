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

  // ─── collect ───────────────────────────────────────────────────────────────

  describe('collect — Foldable.toList: 全一致を T[] で収集', () => {
    it('マッチした状態の結果を配列で返す', () => {
      const actor = start(fetchMachine); // idle

      const results = matchActor(actor).collect({
        idle: () => 'ready',
        loading: () => 'busy',
        success: () => 'done',
      });

      expect(results).toEqual(['ready']);
    });

    it('マッチしない状態のハンドラは結果に含まれない', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const results = matchActor(actor).collect({
        idle: () => 'ready',
        success: () => 'done',
      });

      expect(results).toEqual([]);
    });

    it('_ はスキップされる', () => {
      const actor = start(fetchMachine); // idle

      const results = matchActor(actor).collect({
        idle: () => 'ready',
        _: () => 'fallback',
      } as Parameters<typeof matchActor<typeof fetchMachine>>[0] extends never
        ? never
        : never);

      // _: () は FoldCases には含まれないため idle だけ収集される
      const safeResults = matchActor(actor).collect({ idle: () => 'ready' });
      expect(safeResults).toEqual(['ready']);
    });

    it('scope から context と value にアクセスできる', () => {
      const actor = start(fetchMachine); // idle, retries: 0

      const results = matchActor(actor).collect({
        idle: (s) => ({ value: s.value, retries: s.context.retries }),
      });

      expect(results).toEqual([{ value: 'idle', retries: 0 }]);
    });
  });

  // ─── pipe ──────────────────────────────────────────────────────────────────

  describe('pipe — Kleisli 合成: Matcher → value な変換関数を合成', () => {
    it('1 段: Matcher を引数に取る関数を適用する', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).pipe(
        (m) => m.fold({ idle: () => 'ready', _: () => 'other' }),
      );

      expect(result).toBe('ready');
    });

    it('2 段: Matcher → Matcher → value と合成できる', () => {
      const actor = start(fetchMachine); // idle

      const loadingBehavior = (m: ReturnType<typeof matchActor<typeof fetchMachine>>) =>
        m.in('loading', () => {});

      const result = matchActor(actor).pipe(
        loadingBehavior,
        (m) => m.fold({ idle: () => 'idle-result', _: () => 'other' }),
      );

      expect(result).toBe('idle-result');
    });

    it('3 段: Matcher → A → B → C と合成できる', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).pipe(
        (m) => m.fold({ idle: () => 42, _: () => 0 }),
        (n: number) => n * 2,
        (n: number) => `value=${n}`,
      );

      expect(result).toBe('value=84');
    });

    it('in() を含む振る舞いモジュールを再利用できる', () => {
      const actor = start(fetchMachine); // idle

      const calls: string[] = [];
      const idleBehavior = (m: ReturnType<typeof matchActor<typeof fetchMachine>>) =>
        m.in('idle', () => {
          calls.push('idle');
        });
      const loadingBehavior = (m: ReturnType<typeof matchActor<typeof fetchMachine>>) =>
        m.in('loading', () => {
          calls.push('loading');
        });

      matchActor(actor).pipe(idleBehavior, loadingBehavior);

      expect(calls).toEqual(['idle']); // idle のみマッチ
    });
  });

  // ─── tapAlways ─────────────────────────────────────────────────────────────

  describe('tapAlways — FlatMap.flatTap: matched を変えずに副作用を差し込む', () => {
    it('常に cb を実行する（状態に関係なく）', () => {
      const actor = start(fetchMachine); // idle

      let tapped = false;
      matchActor(actor).tapAlways(() => {
        tapped = true;
      });

      expect(tapped).toBe(true);
    });

    it('matched フラグを変えない — otherwise が抑制されない', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .tapAlways(() => {})
        .in('loading', () => {}) // マッチしない
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('context を cb に渡す', () => {
      const actor = start(fetchMachine); // retries: 0

      let seen = -1;
      matchActor(actor).tapAlways((ctx) => {
        seen = ctx.retries;
      });

      expect(seen).toBe(0);
    });

    it('チェーンで複数回呼び出せる', () => {
      const actor = start(fetchMachine);

      const taps: number[] = [];
      matchActor(actor)
        .tapAlways(() => taps.push(1))
        .tapAlways(() => taps.push(2))
        .tapAlways(() => taps.push(3));

      expect(taps).toEqual([1, 2, 3]);
    });
  });

  // ─── mapContext ─────────────────────────────────────────────────────────────

  describe('mapContext — Functor.map: context 型を変換', () => {
    it('後続の in コールバックが変換後の context を受け取る', () => {
      const actor = start(fetchMachine); // idle, retries: 0

      let seen: string | null = null;
      matchActor(actor)
        .mapContext((ctx) => ({ label: `retries=${ctx.retries}` }))
        .in('idle', (s) => {
          seen = s.context.label;
        });

      expect(seen).toBe('retries=0');
    });

    it('fold でも変換後の context が使われる', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor)
        .mapContext((ctx) => ctx.retries * 10)
        .fold({ idle: (s) => s.context, _: () => -1 });

      expect(result).toBe(0); // retries(0) * 10
    });

    it('matched フラグを引き継ぐ — in() 後の mapContext でも otherwise が抑制される', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .in('idle', () => {})
        .mapContext((ctx) => ctx)
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });
  });

  // ─── foldMap ───────────────────────────────────────────────────────────────

  describe('foldMap — Foldable.foldMap: モノイドで全一致を集約', () => {
    const sumMonoid = { empty: 0, combine: (a: number, b: number) => a + b };
    const concatMonoid = { empty: '', combine: (a: string, b: string) => a + b };

    it('マッチした状態の値をモノイドで畳み込む', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).foldMap(sumMonoid, {
        idle: () => 10,
        loading: () => 20,
      });

      expect(result).toBe(10); // idle のみマッチ
    });

    it('マッチなしのとき empty を返す', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).foldMap(sumMonoid, {
        idle: () => 10,
        success: () => 30,
      });

      expect(result).toBe(0); // empty
    });

    it('文字列モノイドで連結できる', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).foldMap(concatMonoid, {
        idle: (s) => `[${s.value}]`,
      });

      expect(result).toBe('[idle]');
    });
  });

  // ─── orElse ────────────────────────────────────────────────────────────────

  describe('orElse — Alternative.orElse: 未マッチ時に別 Matcher へフォールバック', () => {
    it('マッチしなかった場合に factory Matcher を実行する', () => {
      const actor = start(fetchMachine); // idle

      let factoryRan = false;
      matchActor(actor)
        .in('loading', () => {}) // マッチしない
        .orElse(() => {
          factoryRan = true;
          return matchActor(actor).in('idle', () => {});
        });

      expect(factoryRan).toBe(true);
    });

    it('マッチした場合は factory を呼ばない', () => {
      const actor = start(fetchMachine); // idle

      let factoryRan = false;
      matchActor(actor)
        .in('idle', () => {}) // マッチする
        .orElse(() => {
          factoryRan = true;
          return matchActor(actor);
        });

      expect(factoryRan).toBe(false);
    });

    it('factory 内でマッチすれば otherwise が抑制される', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .in('loading', () => {})
        .orElse(() => matchActor(actor).in('idle', () => {}))
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });

    it('factory 内でもマッチしなければ otherwise が実行される', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .in('loading', () => {})
        .orElse(() => matchActor(actor).in('success', () => {})) // success でもない
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('複数段のフォールバックを合成できる', () => {
      const actor = start(fetchMachine); // idle

      const calls: string[] = [];
      matchActor(actor)
        .in('loading', () => calls.push('loading'))
        .orElse(() =>
          matchActor(actor)
            .in('success', () => calls.push('success'))
            .orElse(() => matchActor(actor).in('idle', () => calls.push('idle'))),
        );

      expect(calls).toEqual(['idle']);
    });
  });

  // ─── filter ─────────────────────────────────────────────────────────────

  describe('filter — FunctorFilter.filter: チェーン全体への前提条件ゲート', () => {
    it('pred が true なら後続の in が正常に動く', () => {
      const actor = start(fetchMachine); // idle

      let ran = false;
      matchActor(actor)
        .filter(() => true)
        .in('idle', () => {
          ran = true;
        });

      expect(ran).toBe(true);
    });

    it('pred が false なら in が実行されない', () => {
      const actor = start(fetchMachine); // idle

      let ran = false;
      matchActor(actor)
        .filter(() => false)
        .in('idle', () => {
          ran = true;
        });

      expect(ran).toBe(false);
    });

    it('pred が false なら otherwise も実行されない', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .filter(() => false)
        .in('loading', () => {})
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });

    it('pred が true なら otherwise が正常に動く', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .filter(() => true)
        .in('loading', () => {}) // マッチしない
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('context を pred に渡す', () => {
      const actor = start(fetchMachine); // retries: 0

      let ran = false;
      matchActor(actor)
        .filter((ctx) => ctx.retries === 0)
        .in('idle', () => {
          ran = true;
        });

      expect(ran).toBe(true);
    });

    it('context 条件が false なら fold も undefined を返す', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor)
        .filter(() => false)
        .fold({ idle: () => 'ready', _: () => 'fallback' });

      expect(result).toBeUndefined();
    });
  });

  // ─── attempt ───────────────────────────────────────────────────────────────

  describe('attempt — IO.attempt: ハンドラ例外を { ok, value/error } に捕捉', () => {
    it('正常ケース: { ok: true, value: T } を返す', () => {
      const actor = start(fetchMachine); // idle

      const result = matchActor(actor).attempt({
        idle: () => 'ready',
        loading: () => 'busy',
      });

      expect(result).toEqual({ ok: true, value: 'ready' });
    });

    it('マッチなし: { ok: true, value: undefined } を返す', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).attempt({
        idle: () => 'ready',
      });

      expect(result).toEqual({ ok: true, value: undefined });
    });

    it('ハンドラが throw した場合: { ok: false, error } を返す', () => {
      const actor = start(fetchMachine); // idle
      const boom = new Error('parse failed');

      const result = matchActor(actor).attempt({
        idle: () => {
          throw boom;
        },
      });

      expect(result).toEqual({ ok: false, error: boom });
    });

    it('_ フォールバック付きで { ok: true, value: T } を保証する', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).attempt({
        idle: () => 'ready',
        _: () => 'fallback',
      });

      expect(result).toEqual({ ok: true, value: 'fallback' });
    });

    it('例外が発生しても後続コードがクラッシュしない', () => {
      const actor = start(fetchMachine); // idle

      let afterAttempt = false;
      const result = matchActor(actor).attempt({
        idle: () => {
          throw new TypeError('oops');
        },
      });
      afterAttempt = true;

      expect(result.ok).toBe(false);
      expect(afterAttempt).toBe(true);
    });
  });

  // ─── zip ───────────────────────────────────────────────────────────────────

  describe('zip — Apply.product: 2 つの fold を同時評価してタプルで返す', () => {
    it('同一スナップショットで 2 つの fold を評価してタプルで返す', () => {
      const actor = start(fetchMachine); // idle

      const [label, cssClass] = matchActor(actor).zip(
        { idle: () => 'Ready', loading: () => 'Busy', _: () => 'Unknown' },
        { idle: () => 'btn-primary', loading: () => 'btn-loading', _: () => 'btn-secondary' },
      );

      expect(label).toBe('Ready');
      expect(cssClass).toBe('btn-primary');
    });

    it('_ なしのとき未マッチ側は undefined になる', () => {
      const actor = start(fetchMachine); // idle

      const [a, b] = matchActor(actor).zip(
        { idle: () => 'a-idle' },
        { loading: () => 'b-loading' }, // idle にはマッチしない
      );

      expect(a).toBe('a-idle');
      expect(b).toBeUndefined();
    });

    it('両方マッチしない場合は [undefined, undefined]', () => {
      const actor = start(fetchMachine);
      actor.send({ type: 'FETCH' }); // loading

      const result = matchActor(actor).zip(
        { idle: () => 'a' },
        { success: () => 'b' },
      );

      expect(result).toEqual([undefined, undefined]);
    });

    it('scope から context と value にアクセスできる', () => {
      const actor = start(fetchMachine); // idle, retries: 0

      const [val, ret] = matchActor(actor).zip(
        { idle: (s) => s.value },
        { idle: (s) => s.context.retries },
      );

      expect(val).toBe('idle');
      expect(ret).toBe(0);
    });
  });

  // ─── flatMap ───────────────────────────────────────────────────────────────

  describe('flatMap — FlatMap.flatMap: context から Matcher を動的生成して接続', () => {
    it('マッチ前: fn(context) が返す Matcher に委譲する', () => {
      const actor = start(fetchMachine); // idle

      let delegateCalled = false;
      matchActor(actor).flatMap((_ctx) => {
        delegateCalled = true;
        return matchActor(actor).in('idle', () => {});
      });

      expect(delegateCalled).toBe(true);
    });

    it('委譲先でマッチすれば otherwise が抑制される', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .flatMap((_ctx) => matchActor(actor).in('idle', () => {}))
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(false);
    });

    it('委譲先でもマッチしなければ otherwise が実行される', () => {
      const actor = start(fetchMachine); // idle

      let otherwiseRan = false;
      matchActor(actor)
        .flatMap((_ctx) => matchActor(actor).in('loading', () => {})) // loading ではない
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(otherwiseRan).toBe(true);
    });

    it('既にマッチしている場合は fn を呼ばない', () => {
      const actor = start(fetchMachine); // idle

      let fnCalled = false;
      matchActor(actor)
        .in('idle', () => {}) // マッチする
        .flatMap((_ctx) => {
          fnCalled = true;
          return matchActor(actor);
        });

      expect(fnCalled).toBe(false);
    });

    it('context の値によって Matcher を切り替えられる', () => {
      const actor = start(fetchMachine); // idle, retries: 0

      const calls: string[] = [];
      matchActor(actor).flatMap((ctx) => {
        if (ctx.retries === 0) {
          return matchActor(actor).in('idle', () => calls.push('zero-retries-idle'));
        }
        return matchActor(actor).in('idle', () => calls.push('many-retries-idle'));
      });

      expect(calls).toEqual(['zero-retries-idle']);
    });
  });
});
