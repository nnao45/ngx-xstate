/**
 * 18: 状態スコープ付き型安全イベント送信（case/when）
 *
 * actor.in('idle', idle => idle.send(...)) で、現在の状態にマッチしたときだけ
 * 実行し、その状態で有効なイベントだけを型安全に送れる。
 *
 * - .in(name, cb).in(name, cb) で case/when（同一階層・横）
 * - .within(name, cb) で複合状態の子へ潜る（cb を抜けるとトップに戻る）
 * - .otherwise() で default
 * - scope.send はその状態で無効なイベントをコンパイルエラーにする
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { injectActor, matchActor, noPayload, typedSetup } from '../src/public-api';

const trafficMachine = typedSetup({
  events: { GO: noPayload, CAUTION: noPayload, STOP: noPayload },
}).createMachine({
  id: 'traffic',
  initial: 'red',
  states: {
    red: { on: { GO: 'green' } },
    green: { on: { CAUTION: 'yellow' } },
    yellow: { on: { STOP: 'red' } },
  },
});

const sessionMachine = typedSetup({
  context: z.object({ user: z.string() }),
  events: {
    LOGIN: z.object({ user: z.string() }),
    LOGOUT: noPayload,
    IDLE: noPayload,
    WAKE: noPayload,
  },
}).createMachine({
  id: 'session',
  context: { user: '' },
  initial: 'anon',
  states: {
    anon: {
      on: { LOGIN: { target: 'auth', actions: assign({ user: ({ event }) => event.user }) } },
    },
    auth: {
      initial: 'active',
      states: {
        active: { on: { IDLE: 'idle' } },
        idle: { on: { WAKE: 'active' } },
      },
      on: { LOGOUT: 'anon' },
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

describe('18: State-scoped type-safe send (case/when)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('case/when chain dispatches only the active branch', () => {
    const { snapshot, in: $in } = run(() => injectActor(trafficMachine));

    // red の時だけ GO が走る
    $in('red', (red) => {
      red.send({ type: 'GO' });
    })
      .in('green', (green) => {
        green.send({ type: 'CAUTION' });
      })
      .otherwise(() => {
        throw new Error('unreachable');
      });

    expect(snapshot().value).toBe('green');
  });

  it('otherwise fires when no branch matches', () => {
    const { send, in: $in } = run(() => injectActor(trafficMachine));
    send({ type: 'GO' }); // green

    let fallback = false;
    $in('red', () => {
      throw new Error('unreachable');
    })
      .in('yellow', () => {
        throw new Error('unreachable');
      })
      .otherwise(() => {
        fallback = true;
      });

    expect(fallback).toBe(true);
  });

  it('descends into nested states with .within() and reads payload context', () => {
    const { snapshot, send, actorRef } = run(() => injectActor(sessionMachine));
    send({ type: 'LOGIN', user: 'alice' }); // auth.active

    matchActor(actorRef).within('auth', (s) =>
      s.in('active', (active) => {
        active.send({ type: 'IDLE' });
        expect(active.context.user).toBe('alice');
      }),
    );

    expect(snapshot().value).toEqual({ auth: 'idle' });
    expect(snapshot().context.user).toBe('alice');
  });

  it('re-ascends to a top-level branch after a within block', () => {
    const { snapshot, in: $in } = run(() => injectActor(sessionMachine)); // anon

    let anonRan = false;
    $in('anon', (anon) => {
      anon.send({ type: 'LOGIN', user: 'bob' });
    })
      .within('auth', (s) =>
        s.in('active', () => {
          throw new Error('unreachable — chain captured the anon snapshot');
        }),
      )
      .in('anon', () => {
        anonRan = true; // within を抜けてトップ階層へ戻れている
      });

    expect(anonRan).toBe(true);
    expect(snapshot().value).toEqual({ auth: 'active' });
  });
});
