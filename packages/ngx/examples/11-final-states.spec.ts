/**
 * 11: Final States — 完了フロー
 *
 * type: 'final' の状態は「終了状態」。
 * actor が final state に達すると done になる。
 *
 * typedSetup: PROCEED_TO_PAYMENT / PAY / CANCEL / FINISH /
 * NEXT / BACK / COMPLETE を自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, fromPromise } from 'xstate';
import { z } from 'zod';
import { typedSetup, noPayload, injectActor } from '../src/public-api';

const checkoutMachine = typedSetup({
  context: z.object({ orderId: z.string() }),
  events: { PROCEED_TO_PAYMENT: noPayload, PAY: noPayload, CANCEL: noPayload, FINISH: noPayload },
  actors: { processPayment: fromPromise(() => Promise.resolve({ orderId: 'ORD-001' })) },
}).createMachine({
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
        src: 'processPayment',
        onDone: {
          target: 'confirmation',
          // event.output は processPayment の出力に型付けされる
          actions: assign({ orderId: ({ event }) => event.output.orderId }),
        },
        onError: 'payment',
      },
    },
    confirmation: {
      on: { FINISH: 'done' },
    },
    done: { type: 'final' },
  },
});

const onboardingMachine = typedSetup({
  events: { NEXT: noPayload, BACK: noPayload, COMPLETE: noPayload },
}).createMachine({
  id: 'onboarding',
  initial: 'welcome',
  states: {
    welcome: { on: { NEXT: 'profile' } },
    profile: { on: { NEXT: 'preferences', BACK: 'welcome' } },
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
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(checkoutMachine));

      send({ type: 'PROCEED_TO_PAYMENT' });
      send({ type: 'PAY' });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(snapshot().value).toBe('confirmation');
      expect(snapshot().context.orderId).toBe('ORD-001');

      send({ type: 'FINISH' });

      expect(snapshot().value).toBe('done');
    });

    it('actor status is "done" when in final state', async () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(checkoutMachine));

      send({ type: 'PROCEED_TO_PAYMENT' });
      send({ type: 'PAY' });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      send({ type: 'FINISH' });

      // final state に到達すると actor の status が 'done' になる
      expect(snapshot().status).toBe('done');
    });

    it('can cancel from payment and return to cart', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(checkoutMachine));

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

      send({ type: 'NEXT' });
      send({ type: 'NEXT' });
      send({ type: 'COMPLETE' });

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
