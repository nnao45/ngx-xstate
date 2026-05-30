/**
 * 04: Guards — 条件付き遷移
 *
 * guard は遷移の「門番」。条件を満たす場合だけ遷移を許可する。
 * 同じイベントでも条件によって異なる遷移先に分岐できる。
 * statecharts.dev の「条件付き遷移」概念に対応。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, createMachine, setup } from 'xstate';
import { injectActor } from '../src/public-api';

// 最大値/最小値のガード付きカウンター
const boundedCounterMachine = setup({
  guards: {
    canIncrement: ({ context }: { context: { count: number } }) => context.count < 10,
    canDecrement: ({ context }: { context: { count: number } }) => context.count > 0,
  },
}).createMachine({
  id: 'boundedCounter',
  context: { count: 5 },
  on: {
    INCREMENT: {
      guard: 'canIncrement',
      actions: assign({ count: ({ context }) => context.count + 1 }),
    },
    DECREMENT: {
      guard: 'canDecrement',
      actions: assign({ count: ({ context }) => context.count - 1 }),
    },
  },
});

// ログイン状態によって遷移先が変わる machine
const authMachine = setup({
  types: {
    context: {} as { isAdmin: boolean },
    events: {} as { type: 'LOGIN' } | { type: 'LOGOUT' },
  },
  guards: {
    isAdmin: ({ context }) => context.isAdmin,
  },
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
        injectActor(boundedCounterMachine, { input: undefined }),
      );
      // 上限まで増やす
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
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(authMachine),
      );

      send({ type: 'LOGIN' });

      expect(snapshot().matches('loggedIn')).toBe(true);
    });
  });
});
