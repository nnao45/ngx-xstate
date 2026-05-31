import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import { z } from 'zod';
import { injectActor } from './inject-actor';
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

function run<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

describe('state-match (matchActor / injectActor.in)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('injectActor().in — case/when chain', () => {
    it('runs only the matching branch and sends a valid event', () => {
      const { snapshot, in: $in } = run(() => injectActor(fetchMachine));

      let ran = '';
      $in('idle', (idle) => {
        ran = idle.value;
        idle.send({ type: 'FETCH' }); // idle → loading
      }).in('loading', () => {
        ran += ':loading';
      });

      // idle 分岐だけ実行（chain 評価時は idle だったので loading 分岐は走らない）
      expect(ran).toBe('idle');
      expect(snapshot().value).toBe('loading');
    });

    it('matches loading after transition and sends a state-valid event', () => {
      const { snapshot, send, in: $in } = run(() => injectActor(fetchMachine));
      send({ type: 'FETCH' }); // → loading

      $in('loading', (loading) => {
        loading.send({ type: 'RESOLVE' });
      });

      expect(snapshot().value).toBe('success');
    });

    it('exposes context and value in scope', () => {
      const { in: $in } = run(() => injectActor(fetchMachine));
      let seen: { value: string; retries: number } | null = null;

      $in('idle', (idle) => {
        seen = { value: idle.value, retries: idle.context.retries };
      });

      expect(seen).toEqual({ value: 'idle', retries: 0 });
    });
  });

  describe('otherwise', () => {
    it('runs otherwise when no branch matched', () => {
      const { send, in: $in } = run(() => injectActor(fetchMachine));
      send({ type: 'FETCH' }); // loading

      let fellThrough = false;
      $in('idle', () => {
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
      const { in: $in } = run(() => injectActor(fetchMachine));

      let otherwiseRan = false;
      let idleRan = false;
      $in('idle', () => {
        idleRan = true;
      }).otherwise(() => {
        otherwiseRan = true;
      });

      expect(idleRan).toBe(true);
      expect(otherwiseRan).toBe(false);
    });
  });

  describe('nested states via .within()', () => {
    it('descends into loggedIn.active and forwards a child event', () => {
      const { snapshot, send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      matchActor(actorRef).within('loggedIn', (s) =>
        s.in('active', (active) => {
          ran = true;
          active.send({ type: 'GO_IDLE' });
        }),
      );

      expect(ran).toBe(true);
      expect(snapshot().value).toEqual({ loggedIn: 'away' });
    });

    it('does not match a child when in a different child', () => {
      const { send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // active

      let awayRan = false;
      matchActor(actorRef).within('loggedIn', (s) =>
        s.in('away', () => {
          awayRan = true;
        }),
      );

      expect(awayRan).toBe(false);
    });

    it('returns to the top level after a within block (re-ascent)', () => {
      // ここが今回の肝。within で潜ったあとも外チェーンはトップのまま。
      const { actorRef } = run(() => injectActor(authMachine)); // loggedOut

      let activeRan = false;
      let loggedOutRan = false;
      matchActor(actorRef)
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
      const { actorRef } = run(() => injectActor(authMachine)); // loggedOut

      let innerOtherwiseRan = false;
      matchActor(actorRef).within('loggedIn', (s) => {
        s.in('active', () => {}).otherwise(() => {
          innerOtherwiseRan = true; // loggedIn に居ないので発火しない
        });
      });

      expect(innerOtherwiseRan).toBe(false);
    });

    it('runs the inner otherwise when the parent is active but no child matched', () => {
      const { send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // loggedIn.active

      let innerOtherwiseRan = false;
      matchActor(actorRef).within('loggedIn', (s) => {
        s.in('away', () => {}) // active なので一致しない
          .otherwise(() => {
            innerOtherwiseRan = true;
          });
      });

      expect(innerOtherwiseRan).toBe(true);
    });

    it('suppresses the outer otherwise when within matched the parent', () => {
      const { send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // loggedIn.active

      let outerOtherwiseRan = false;
      matchActor(actorRef)
        .within('loggedIn', (s) => s.in('active', () => {}))
        .otherwise(() => {
          outerOtherwiseRan = true; // loggedIn に居る＝トップは一致済み
        });

      expect(outerOtherwiseRan).toBe(false);
    });

    it('lets .in() handle a compound parent state directly', () => {
      const { snapshot, send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      // 親 loggedIn 自身の on(LOGOUT) を、子に潜らず .in で扱う
      matchActor(actorRef).in('loggedIn', (loggedIn) => {
        ran = true;
        loggedIn.send({ type: 'LOGOUT' });
      });

      expect(ran).toBe(true);
      expect(snapshot().value).toBe('loggedOut');
    });

    it('does not match a top-level state when in a different one', () => {
      const { actorRef } = run(() => injectActor(authMachine)); // loggedOut

      let ran = false;
      matchActor(actorRef).in('loggedIn', () => {
        ran = true;
      });

      expect(ran).toBe(false);
    });
  });

  describe('injectActor with dynamic input exposes .in / .within', () => {
    const inputMachine = typedSetup({
      context: z.object({ seed: z.string() }),
      input: z.object({ seed: z.string() }),
      events: { GO: noPayload },
    }).createMachine({
      id: 'dyn',
      context: ({ input }) => ({ seed: input.seed }),
      initial: 'start',
      states: { start: { on: { GO: 'done' } }, done: {} },
    });

    it('.in() matches and sends on a dynamic-input actor', () => {
      const { snapshot, in: $in } = run(() =>
        injectActor(inputMachine, { input: () => ({ seed: 'x' }) }),
      );

      let ran = false;
      $in('start', (start) => {
        ran = true;
        start.send({ type: 'GO' });
      });

      expect(ran).toBe(true);
      expect(snapshot().value).toBe('done');
    });

    it('exposes within on a dynamic-input actor', () => {
      const { within } = run(() => injectActor(authMachine, { input: () => ({}) }));
      // loggedOut なので潜っても何も走らないが、API が生えていることを確認
      let ran = false;
      within('loggedIn', (s) =>
        s.in('active', () => {
          ran = true;
        }),
      );
      expect(ran).toBe(false);
    });
  });

  describe('matchActor standalone (raw actorRef.send)', () => {
    it('matches and sends via the raw actor', () => {
      const { actorRef, snapshot } = run(() => injectActor(fetchMachine));

      matchActor(actorRef).in('idle', (idle) => {
        idle.send({ type: 'FETCH' });
      });

      expect(snapshot().value).toBe('loading');
    });
  });

  // typedSetup ブランドが無い素の setup マシンでも状態名が never に潰れず動く。
  // scope.send は「全イベント許可」にフォールバック（状態別の絞り込みのみ失われる）。
  describe('plain xstate setup machine (no typedSetup brand)', () => {
    it('.in() matches a real top-level state name and sends', () => {
      const { actorRef, snapshot } = run(() => injectActor(plainAuthMachine));

      let ran = '';
      matchActor(actorRef)
        .in('loggedOut', (out) => {
          ran = out.value; // 'loggedOut'（never ではない）
          out.send({ type: 'LOGIN' });
        })
        .in('loggedIn', () => {
          ran = 'loggedIn';
        });

      expect(ran).toBe('loggedOut');
      expect(snapshot().value).toEqual({ loggedIn: 'active' });
    });

    it('.within() descends into a compound state derived from the schema', () => {
      const { actorRef, snapshot, send } = run(() => injectActor(plainAuthMachine));
      send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      matchActor(actorRef).within('loggedIn', (s) =>
        s.in('active', (active) => {
          ran = true;
          active.send({ type: 'GO_IDLE' });
        }),
      );

      expect(ran).toBe(true);
      expect(snapshot().value).toEqual({ loggedIn: 'away' });
    });

    it('re-ascends and runs otherwise on a plain machine', () => {
      const { actorRef } = run(() => injectActor(plainAuthMachine)); // loggedOut

      let activeRan = false;
      let otherwiseRan = false;
      matchActor(actorRef)
        .within('loggedIn', (s) =>
          s.in('active', () => {
            activeRan = true;
          }),
        )
        .in('loggedIn', () => {}) // 不一致
        .otherwise(() => {
          otherwiseRan = true; // loggedOut に居る＝どのトップ分岐も未一致
        });

      expect(activeRan).toBe(false);
      expect(otherwiseRan).toBe(true);
    });

    it('exposes in/within on injectActor for a plain machine', () => {
      const { in: $in, within, snapshot } = run(() => injectActor(plainAuthMachine));

      $in('loggedOut', (out) => {
        out.send({ type: 'LOGIN' });
      });
      within('loggedIn', (s) =>
        s.in('active', (active) => {
          active.send({ type: 'GO_IDLE' });
        }),
      );

      expect(snapshot().value).toEqual({ loggedIn: 'away' });
    });
  });
});
