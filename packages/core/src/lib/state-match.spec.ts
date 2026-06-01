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
});
