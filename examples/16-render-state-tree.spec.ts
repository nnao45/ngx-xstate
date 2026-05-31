/**
 * 16: renderStateTree — コンソール用の状態ツリー文字列
 *
 * machine を渡すと静的な構造、actor を渡すと現在状態ハイライト付きの
 * ASCII ツリー文字列が得られる。console.log やログ、スナップショットテストに使う。
 *
 * SVG 等のアプリ内描画は提供しない（XState 本家同様、リッチな可視化は
 * provideXstateDevtools 経由で外部 Stately Visualizer に任せる）。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { injectActor, noPayload, renderStateTree, typedSetup } from '../src/public-api';

const checkoutMachine = typedSetup({
  context: z.object({ items: z.number() }),
  events: { ADD: noPayload, PAY: noPayload, BACK: noPayload },
}).createMachine({
  id: 'checkout',
  initial: 'cart',
  context: { items: 0 },
  states: {
    cart: {
      on: {
        ADD: { actions: assign({ items: ({ context }) => context.items + 1 }) },
        PAY: 'paying',
      },
    },
    paying: {
      initial: 'entering',
      states: {
        entering: { on: { PAY: 'confirming' } },
        confirming: {},
      },
      on: { BACK: 'cart' },
    },
    done: { type: 'final' },
  },
});

describe('16: renderStateTree', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('renders the static structure of a machine', () => {
    const tree = renderStateTree(checkoutMachine);

    // machine 入力 → 現在マーカーなし、構造とバッジのみ
    expect(tree).toBe(
      [
        'checkout',
        '├─ cart  (initial)',
        '├─ paying',
        '│  ├─ entering  (initial)',
        '│  └─ confirming',
        '└─ done  (final)',
      ].join('\n'),
    );
  });

  it('highlights the current state of a running actor', () => {
    const { actorRef, send } = TestBed.runInInjectionContext(() => injectActor(checkoutMachine));

    send({ type: 'PAY' }); // cart → paying.entering

    const tree = renderStateTree(actorRef);
    const lines = tree.split('\n');

    // paying と その初期子 entering がアクティブ
    expect(lines.find((l) => l.includes('paying'))).toContain('●');
    expect(lines.find((l) => l.includes('entering'))).toContain('●');
    // cart は離脱済み
    expect(lines.find((l) => l.includes('cart'))).not.toContain('●');
  });

  it('updates as the actor transitions deeper', () => {
    const { actorRef, send } = TestBed.runInInjectionContext(() => injectActor(checkoutMachine));

    send({ type: 'PAY' }); // paying.entering
    send({ type: 'PAY' }); // paying.confirming

    const lines = renderStateTree(actorRef).split('\n');
    expect(lines.find((l) => l.includes('confirming'))).toContain('●');
    expect(lines.find((l) => l.includes('entering'))).not.toContain('●');
  });
});
