/**
 * 11: Final States — 完了フロー
 *
 * type: 'final' の状態は「終了状態」。
 * actor が final state に達すると done になり、
 * 親の machine や invoke の onDone が呼ばれる。
 *
 * 典型例: 支払いフロー、オンボーディング、ファイルアップロード
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, createMachine, fromPromise } from 'xstate';
import { injectActor } from '../src/public-api';

// 支払いフロー: cart → payment → confirmation → done
const checkoutMachine = createMachine({
  id: 'checkout',
  initial: 'cart',
  context: { orderId: '' },
  states: {
    cart: {
      on: { PROCEED_TO_PAYMENT: 'payment' },
    },
    payment: {
      on: {
        PAY: 'processing',
        CANCEL: 'cart',
      },
    },
    processing: {
      invoke: {
        src: fromPromise(() => Promise.resolve({ orderId: 'ORD-001' })),
        onDone: {
          target: 'confirmation',
          actions: assign({
            orderId: ({ event }) => (event.output as { orderId: string }).orderId,
          }),
        },
        onError: 'payment',
      },
    },
    confirmation: {
      on: { FINISH: 'done' },
    },
    // final state: checkout 完了
    done: {
      type: 'final',
    },
  },
});

// 3ステップのオンボーディング
const onboardingMachine = createMachine({
  id: 'onboarding',
  initial: 'welcome',
  states: {
    welcome:  { on: { NEXT: 'profile' } },
    profile:  { on: { NEXT: 'preferences', BACK: 'welcome' } },
    preferences: { on: { COMPLETE: 'finished' } },
    finished: { type: 'final' },
  },
});

describe('11: Final States', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('checkout flow', () => {
    it('starts at cart', () => {
      const { snapshot } = TestBed.runInInjectionContext(() => injectActor(checkoutMachine));
      expect(snapshot().value).toBe('cart');
    });

    it('completes full checkout flow', async () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(checkoutMachine),
      );

      send({ type: 'PROCEED_TO_PAYMENT' });
      send({ type: 'PAY' });
      // invoke の Promise → onDone アクションまで複数の microtask が必要
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

      expect(snapshot().value).toBe('confirmation');
      expect(snapshot().context.orderId).toBe('ORD-001');

      send({ type: 'FINISH' });

      expect(snapshot().value).toBe('done');
    });

    it('actor status is "done" when in final state', async () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(checkoutMachine),
      );

      send({ type: 'PROCEED_TO_PAYMENT' });
      send({ type: 'PAY' });
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      send({ type: 'FINISH' });

      // final state に到達すると actor の status が 'done' になる
      expect(snapshot().status).toBe('done');
    });

    it('can cancel from payment and return to cart', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(checkoutMachine),
      );

      send({ type: 'PROCEED_TO_PAYMENT' });
      send({ type: 'CANCEL' });

      expect(snapshot().value).toBe('cart');
    });
  });

  describe('onboarding flow', () => {
    it('completes all steps in order', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(onboardingMachine),
      );

      send({ type: 'NEXT' });     // welcome → profile
      send({ type: 'NEXT' });     // profile → preferences
      send({ type: 'COMPLETE' }); // preferences → finished

      expect(snapshot().value).toBe('finished');
      expect(snapshot().status).toBe('done');
    });

    it('supports going back', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() =>
        injectActor(onboardingMachine),
      );

      send({ type: 'NEXT' });
      send({ type: 'BACK' });

      expect(snapshot().value).toBe('welcome');
    });
  });
});
