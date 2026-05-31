import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { injectActor } from './inject-actor';
import { matchActor } from './state-match';
import { typedSetup, noPayload } from './typed-machine';

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
      $in('idle')
        .tap((idle) => {
          ran = idle.value;
          idle.send({ type: 'FETCH' }); // idle → loading
        })
        .in('loading')
        .tap(() => {
          ran += ':loading';
        });

      // idle 分岐だけ実行（chain 評価時は idle だったので loading 分岐は走らない）
      expect(ran).toBe('idle');
      expect(snapshot().value).toBe('loading');
    });

    it('matches loading after transition and sends a state-valid event', () => {
      const { snapshot, send, in: $in } = run(() => injectActor(fetchMachine));
      send({ type: 'FETCH' }); // → loading

      $in('loading').tap((loading) => {
        loading.send({ type: 'RESOLVE' });
      });

      expect(snapshot().value).toBe('success');
    });

    it('exposes context and value in scope', () => {
      const { in: $in } = run(() => injectActor(fetchMachine));
      let seen: { value: string; retries: number } | null = null;

      $in('idle').tap((idle) => {
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
      $in('idle')
        .tap(() => {
          throw new Error('should not run');
        })
        .in('success')
        .tap(() => {
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
      $in('idle')
        .tap(() => {
          idleRan = true;
        })
        .otherwise(() => {
          otherwiseRan = true;
        });

      expect(idleRan).toBe(true);
      expect(otherwiseRan).toBe(false);
    });
  });

  describe('nested states via .in().in()', () => {
    it('matches nested loggedIn.active and forwards a child event', () => {
      const { snapshot, send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      matchActor(actorRef)
        .in('loggedIn')
        .in('active')
        .tap((active) => {
          ran = true;
          active.send({ type: 'GO_IDLE' });
        });

      expect(ran).toBe(true);
      expect(snapshot().value).toEqual({ loggedIn: 'away' });
    });

    it('does not match a child when in a different child', () => {
      const { send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // active

      let awayRan = false;
      matchActor(actorRef)
        .in('loggedIn')
        .in('away')
        .tap(() => {
          awayRan = true;
        });

      expect(awayRan).toBe(false);
    });

    it('does not match a sibling top-level state while in a compound state', () => {
      const { send, actorRef } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // value = { loggedIn: 'active' }（object）

      let ran = false;
      // object 値に対し存在しないトップレベル名 → 不一致（seg not in value）
      matchActor(actorRef)
        .in('loggedOut')
        .tap(() => {
          ran = true;
        });

      expect(ran).toBe(false);
    });

    it('does not match a top-level state when in a different one', () => {
      const { actorRef } = run(() => injectActor(authMachine)); // loggedOut

      let ran = false;
      matchActor(actorRef)
        .in('loggedIn')
        .tap(() => {
          ran = true;
        });

      expect(ran).toBe(false);
    });
  });

  describe('injectActor with dynamic input exposes .in', () => {
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
      $in('start').tap((start) => {
        ran = true;
        start.send({ type: 'GO' });
      });

      expect(ran).toBe(true);
      expect(snapshot().value).toBe('done');
    });
  });

  describe('matchActor standalone (raw actorRef.send)', () => {
    it('matches and sends via the raw actor', () => {
      const { actorRef, snapshot } = run(() => injectActor(fetchMachine));

      matchActor(actorRef)
        .in('idle')
        .tap((idle) => {
          idle.send({ type: 'FETCH' });
        });

      expect(snapshot().value).toBe('loading');
    });
  });
});
