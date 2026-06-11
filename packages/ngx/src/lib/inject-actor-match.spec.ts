import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { typedSetup, noPayload } from '@zstate/core';
import { injectActor } from './inject-actor';

// injectActor が公開する .in / .within（一発読みの case/when マッチャ）の
// クロージャ（buildStaticActor / buildDynamicActor 双方）を検証する。
// マッチャのコアロジック自体は @zstate/core の state-match.spec で網羅済み。

const fetchMachine = typedSetup({
  context: z.object({ retries: z.number() }),
  events: { FETCH: noPayload, RESOLVE: noPayload, CANCEL: noPayload },
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

function run<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

describe('injectActor().in / .within', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('static-input actor', () => {
    it('runs the matching branch and sends a valid event', () => {
      const { snapshot, in: $in } = run(() => injectActor(fetchMachine));

      let ran = '';
      $in('idle', (idle) => {
        ran = idle.value;
        idle.send({ type: 'FETCH' });
      }).in('loading', () => {
        ran += ':loading';
      });

      expect(ran).toBe('idle');
      expect(snapshot().value).toBe('loading');
    });

    it('exposes context and value in scope', () => {
      const { in: $in } = run(() => injectActor(fetchMachine));
      let seen: { value: string; retries: number } | null = null;

      $in('idle', (idle) => {
        seen = { value: idle.value, retries: idle.context.retries };
      });

      expect(seen).toEqual({ value: 'idle', retries: 0 });
    });

    it('descends into a nested state via within and re-ascends', () => {
      const { snapshot, send, within } = run(() => injectActor(authMachine));
      send({ type: 'LOGIN' }); // loggedIn.active

      let ran = false;
      within('loggedIn', (s) =>
        s.in('active', (active) => {
          ran = true;
          active.send({ type: 'GO_IDLE' });
        }),
      );

      expect(ran).toBe(true);
      expect(snapshot().value).toEqual({ loggedIn: 'away' });
    });
  });

  describe('dynamic-input actor', () => {
    it('.in() matches and sends', () => {
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
      // input あり + ネスト状態あり machine で dynamic path の within を確認する
      const nestedInputMachine = typedSetup({
        context: z.object({ userId: z.string() }),
        input: z.object({ userId: z.string() }),
        events: { LOGIN: noPayload, LOGOUT: noPayload, GO_IDLE: noPayload },
      }).createMachine({
        id: 'nestedInput',
        context: ({ input }) => ({ userId: input.userId }),
        initial: 'loggedOut',
        states: {
          loggedOut: { on: { LOGIN: 'loggedIn' } },
          loggedIn: {
            initial: 'active',
            states: {
              active: { on: { GO_IDLE: 'away' } },
              away: {},
            },
            on: { LOGOUT: 'loggedOut' },
          },
        },
      });

      const { within } = run(() =>
        injectActor(nestedInputMachine, { input: () => ({ userId: 'alice' }) }),
      );

      let ran = false;
      within('loggedIn', (s) =>
        s.in('active', () => {
          ran = true;
        }),
      );
      expect(ran).toBe(false); // loggedOut なので潜っても走らない
    });
  });
});
