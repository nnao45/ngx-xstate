/**
 * 04: Guards — 条件付き遷移
 *
 * guard は遷移の「門番」。条件を満たす場合だけ遷移を許可する。
 * XState v5 ではインライン関数として guard を直接書ける。
 *
 * typedSetup: guard はインラインで定義し setup() は不要。
 * on キーから INCREMENT / DECREMENT / LOGIN / LOGOUT を自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { typedSetup, noPayload, injectActor } from '../src/public-api';

// 最大値/最小値のガード付きカウンター — context 型付きでインラインガードも注釈不要
const boundedCounterMachine = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INCREMENT: noPayload, DECREMENT: noPayload },
}).createMachine({
  id: 'boundedCounter',
  context: { count: 5 },
  on: {
    INCREMENT: {
      guard: ({ context }) => context.count < 10,
      actions: assign({ count: ({ context }) => context.count + 1 }),
    },
    DECREMENT: {
      guard: ({ context }) => context.count > 0,
      actions: assign({ count: ({ context }) => context.count - 1 }),
    },
  },
});

// ログイン状態によって遷移先が変わる machine
const authMachine = typedSetup({
  context: z.object({ isAdmin: z.boolean() }),
  events: { LOGIN: noPayload, LOGOUT: noPayload },
}).createMachine({
  id: 'auth',
  initial: 'loggedOut',
  context: { isAdmin: false },
  states: {
    loggedOut: {
      on: { LOGIN: 'loggedIn' },
    },
    loggedIn: {
      initial: 'user',
      states: {
        user: {},
        admin: {},
      },
      on: { LOGOUT: 'loggedOut' },
    },
  },
});

describe('04: Guards — conditional transitions', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('bounded counter', () => {
    it('allows increment when below max', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(boundedCounterMachine),
      );

      send({ type: 'INCREMENT' });

      expect(snapshot().context.count).toBe(6);
    });

    it('blocks increment at maximum (10)', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(boundedCounterMachine),
      );
      for (let i = 0; i < 5; i++) send({ type: 'INCREMENT' });

      // ガードが弾くので 10 を超えない
      send({ type: 'INCREMENT' });
      expect(snapshot().context.count).toBe(10);
    });

    it('blocks decrement at minimum (0)', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(boundedCounterMachine),
      );
      for (let i = 0; i < 5; i++) send({ type: 'DECREMENT' });

      send({ type: 'DECREMENT' });
      expect(snapshot().context.count).toBe(0);
    });
  });

  describe('auth guard', () => {
    it('transitions to loggedIn on LOGIN', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(authMachine));

      send({ type: 'LOGIN' });

      expect(snapshot().matches('loggedIn')).toBe(true);
    });
  });
});
