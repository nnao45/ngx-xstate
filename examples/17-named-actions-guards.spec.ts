/**
 * 17: Named actions / guards — typedSetup({ actions, guards })
 *
 * XState v5 の `setup({ actions, guards })` を Zod 連携でラップ。
 * 名前付き action / guard を **params 型を保持したまま** 宣言し、
 * config 側で `{ type: 'name', params: ... }` または `'name'` で参照できる。
 *
 * - action / guard 関数内で context / event が型付けされる
 * - params（第2引数）の型が config の `params` まで効く
 * - 文字列参照（params 不要な action）も使える
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { injectActor, noPayload, typedSetup } from '../src/public-api';

const counterMachine = typedSetup({
  context: z.object({ count: z.number(), log: z.array(z.string()) }),
  events: { STEP: z.object({ by: z.number() }), RESET: noPayload },
  actions: {
    // params 付き action（config の params が { amount: number } に型付く）
    bump: assign({
      count: ({ context }, params: { amount: number }) => context.count + params.amount,
    }),
    // params なし action（文字列参照可）
    note: assign({ log: ({ context }) => [...context.log, 'noted'] }),
    clear: assign({ count: 0, log: [] }),
  },
  guards: {
    // params 付き guard
    underMax: ({ context }, params: { max: number }) => context.count < params.max,
  },
}).createMachine({
  id: 'counter',
  context: { count: 0, log: [] },
  on: {
    STEP: {
      guard: { type: 'underMax', params: { max: 5 } },
      actions: [{ type: 'bump', params: { amount: 2 } }, 'note'],
    },
    RESET: { actions: 'clear' },
  },
});

describe('17: Named actions / guards (params preserved)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('runs a params-typed action referenced by { type, params }', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));

    send({ type: 'STEP', by: 0 }); // bump params.amount=2 → +2
    expect(snapshot().context.count).toBe(2);
    expect(snapshot().context.log).toEqual(['noted']);
  });

  it('runs multiple actions including a string-referenced one', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));

    send({ type: 'STEP', by: 0 });
    send({ type: 'STEP', by: 0 });
    expect(snapshot().context.count).toBe(4);
    expect(snapshot().context.log).toEqual(['noted', 'noted']);
  });

  it('blocks the transition when the params-typed guard fails', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));

    // max=5 まで。count=4 で STEP すると 4<5 true → +2 = 6
    send({ type: 'STEP', by: 0 }); // 2
    send({ type: 'STEP', by: 0 }); // 4
    send({ type: 'STEP', by: 0 }); // 4<5 → 6
    expect(snapshot().context.count).toBe(6);

    // 6<5 false → guard で弾かれ変化なし
    send({ type: 'STEP', by: 0 });
    expect(snapshot().context.count).toBe(6);
  });

  it('runs the string-referenced reset action', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));

    send({ type: 'STEP', by: 0 });
    send({ type: 'RESET' });
    expect(snapshot().context.count).toBe(0);
    expect(snapshot().context.log).toEqual([]);
  });
});
