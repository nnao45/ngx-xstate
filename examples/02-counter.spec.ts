/**
 * 02: Counter — context (拡張状態) の基本
 *
 * 状態の「値」だけでなく「データ」を持つ。
 * XState では context に任意のデータを格納できる。
 * injectSelector で必要な値だけを Signal として取り出せる。
 *
 * createTypedMachine: INCREMENT / DECREMENT / RESET を自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import {
  createTypedMachine,
  noPayload,
  injectActor,
  injectActorRef,
  injectSelector,
} from '../src/public-api';

const counterMachine = createTypedMachine({
  // context スキーマを渡すと machine 内で context.count が number に型付けされる
  context: z.object({ count: z.number() }),
  events: { INCREMENT: noPayload, DECREMENT: noPayload, RESET: noPayload },
}).create({
  id: 'counter',
  context: { count: 0 },
  on: {
    INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) },
    RESET: { actions: assign({ count: 0 }) },
  },
});

describe('02: Counter', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts at zero', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(counterMachine));
    expect(snapshot().context.count).toBe(0);
  });

  it('increments count', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));

    send({ type: 'INCREMENT' });
    send({ type: 'INCREMENT' });

    expect(snapshot().context.count).toBe(2);
  });

  it('decrements count', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));

    send({ type: 'INCREMENT' });
    send({ type: 'DECREMENT' });

    expect(snapshot().context.count).toBe(0);
  });

  it('resets to zero', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));

    send({ type: 'INCREMENT' });
    send({ type: 'INCREMENT' });
    send({ type: 'RESET' });

    expect(snapshot().context.count).toBe(0);
  });

  // injectSelector: context 全体ではなく必要な値だけを Signal にする
  it('injectSelector extracts count as a dedicated Signal', () => {
    const actorRef = TestBed.runInInjectionContext(() => injectActorRef(counterMachine));
    const count = TestBed.runInInjectionContext(() =>
      injectSelector(actorRef, (s) => s.context.count),
    );

    expect(count()).toBe(0);
    actorRef.send({ type: 'INCREMENT' });
    expect(count()).toBe(1);
  });
});
