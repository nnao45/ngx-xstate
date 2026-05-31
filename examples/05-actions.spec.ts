/**
 * 05: Actions — 副作用の宣言
 *
 * action は状態遷移に伴う副作用を宣言的に記述する。
 * - entry action: 状態に入ったときに実行
 * - exit action:  状態から出るときに実行
 * - transition action: 遷移中に実行
 *
 * XState v5 ではインライン関数として entry / exit / actions を直接書ける。
 * createTypedMachine で on キーを自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { createTypedMachine, injectActor } from '../src/public-api';

describe('05: Actions', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('transition actions — assign でコンテキスト更新', () => {
    const machine = createTypedMachine({
      context: z.object({ count: z.number(), lastEvent: z.string() }),
      events: { INCREMENT: null },
    }).create({
      id: 'withTransitionAction',
      context: { count: 0, lastEvent: '' },
      on: {
        INCREMENT: {
          actions: assign({
            count: ({ context }) => context.count + 1,
            lastEvent: 'INCREMENT',
          }),
        },
      },
    });

    it('runs assign action on transition', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(machine));

      send({ type: 'INCREMENT' });

      expect(snapshot().context.count).toBe(1);
      expect(snapshot().context.lastEvent).toBe('INCREMENT');
    });
  });

  describe('entry / exit actions — インライン関数で直接定義', () => {
    const log: string[] = [];

    const machine = createTypedMachine({
      events: { START: null, STOP: null },
    }).create({
      id: 'withEntryExit',
      initial: 'idle',
      states: {
        idle: {
          entry: () => {
            log.push('entered idle');
          },
          on: { START: 'active' },
        },
        active: {
          entry: () => {
            log.push('entered active');
          },
          exit: () => {
            log.push('exited active');
          },
          on: { STOP: 'idle' },
        },
      },
    });

    afterEach(() => {
      log.length = 0;
    });

    it('runs entry action when entering active', () => {
      const { send } = TestBed.runInInjectionContext(() => injectActor(machine));

      send({ type: 'START' });

      expect(log).toContain('entered active');
    });

    it('runs exit action when leaving active', () => {
      const { send } = TestBed.runInInjectionContext(() => injectActor(machine));

      send({ type: 'START' });
      send({ type: 'STOP' });

      expect(log).toContain('exited active');
    });

    it('runs entry action for initial state on actor start', () => {
      // actor が start() されると initial state の entry action が実行される
      TestBed.runInInjectionContext(() => injectActor(machine));

      expect(log).toContain('entered idle');
    });
  });

  describe('action with event payload', () => {
    const machine = createTypedMachine({
      context: z.object({ message: z.string() }),
      events: { NOTIFY: z.object({ text: z.string() }) },
    }).create({
      id: 'withPayload',
      context: { message: '' },
      on: {
        NOTIFY: { actions: assign({ message: ({ event }) => event.text }) },
      },
    });

    it('assigns event payload to context', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(machine));

      send({ type: 'NOTIFY', text: 'Hello World' });

      expect(snapshot().context.message).toBe('Hello World');
    });
  });

  describe('multiple actions on one transition', () => {
    const sideEffect = vi.fn();

    const machine = createTypedMachine({
      context: z.object({ count: z.number() }),
      events: { DO: null },
    }).create({
      id: 'multiAction',
      context: { count: 0 },
      on: {
        DO: {
          // 複数 action を配列で指定 — 順番通りに実行される
          actions: [
            assign({ count: ({ context }) => context.count + 1 }),
            () => {
              sideEffect('logged');
            },
          ],
        },
      },
    });

    afterEach(() => {
      sideEffect.mockClear();
    });

    it('executes all actions in order', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(machine));

      send({ type: 'DO' });

      expect(snapshot().context.count).toBe(1);
      expect(sideEffect).toHaveBeenCalledWith('logged');
    });
  });
});
