import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { createTypedMachine } from './typed-machine';
import { injectActor } from './inject-actor';

function run<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

// ─── 基本 machine（payload なし） ─────────────────────────────────────────────

const toggleMachine = createTypedMachine({
  events: { TOGGLE: null },
}).create({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { on: { TOGGLE: 'inactive' } },
  },
});

// ─── payload あり machine ──────────────────────────────────────────────────────

const counterMachine = createTypedMachine({
  context: z.object({ count: z.number() }),
  events: { INCREMENT: null, DECREMENT: null, SET: z.object({ value: z.number() }) },
}).create({
  id: 'counter',
  context: { count: 0 },
  on: {
    INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) },
    SET: { actions: assign({ count: ({ event }) => event.value }) },
  },
});

// ─── ネスト machine ─────────────────────────────────────────────────────────────

const authMachine = createTypedMachine({
  events: { LOGIN: null, LOGOUT: null, GO_IDLE: null, WAKE_UP: null },
}).create({
  id: 'auth',
  initial: 'loggedOut',
  states: {
    loggedOut: { on: { LOGIN: 'loggedIn' } },
    loggedIn: {
      initial: 'active',
      states: {
        active: { on: { GO_IDLE: 'idle' } },
        idle: { on: { WAKE_UP: 'active' } },
      },
      on: { LOGOUT: 'loggedOut' },
    },
  },
});

describe('createTypedMachine', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('basic toggle (no payloads)', () => {
    it('starts in initial state', () => {
      const { snapshot } = run(() => injectActor(toggleMachine));
      expect(snapshot().value).toBe('inactive');
    });

    it('transitions on TOGGLE', () => {
      const { snapshot, send } = run(() => injectActor(toggleMachine));
      send({ type: 'TOGGLE' });
      expect(snapshot().value).toBe('active');
    });

    it('warns and no-ops on unknown event (strict: false default)', () => {
      const { snapshot, send } = run(() => injectActor(toggleMachine));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      send({ type: 'UNKNOWN' } as never);

      expect(snapshot().value).toBe('inactive');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('machine with payloads', () => {
    it('accepts payload-less events', () => {
      const { snapshot, send } = run(() => injectActor(counterMachine));
      send({ type: 'INCREMENT' });
      expect(snapshot().context.count).toBe(1);
    });

    it('accepts events with Zod-validated payloads', () => {
      const { snapshot, send } = run(() => injectActor(counterMachine));
      send({ type: 'SET', value: 42 });
      expect(snapshot().context.count).toBe(42);
    });

    it('warns and no-ops when payload fails Zod validation (strict: false)', () => {
      const { snapshot, send } = run(() => injectActor(counterMachine));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      // value は number であるべき
      send({ type: 'SET', value: 'not-a-number' } as never);

      expect(snapshot().context.count).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws on invalid payload in strict mode', () => {
      const strictMachine = createTypedMachine({
        context: z.object({ value: z.number() }),
        events: { SET: z.object({ n: z.number() }) },
        strict: true,
      }).create({
        id: 'strict',
        context: { value: 0 },
        on: {
          SET: { actions: assign({ value: ({ event }) => event.n }) },
        },
      });

      const { send } = run(() => injectActor(strictMachine));
      expect(() => {
        send({ type: 'SET', n: 'bad' } as never);
      }).toThrow();
    });
  });

  describe('nested state — イベントが全階層から集約される', () => {
    it('collects events from top-level and nested states', () => {
      const { snapshot, send } = run(() => injectActor(authMachine));

      // top-level イベント
      send({ type: 'LOGIN' });
      expect(snapshot().matches('loggedIn')).toBe(true);

      // ネストイベント（loggedIn 内）
      send({ type: 'GO_IDLE' });
      expect(snapshot().value).toEqual({ loggedIn: 'idle' });

      // ネストイベント（loggedIn.idle 内）
      send({ type: 'WAKE_UP' });
      expect(snapshot().value).toEqual({ loggedIn: 'active' });

      // top へ戻る
      send({ type: 'LOGOUT' });
      expect(snapshot().value).toBe('loggedOut');
    });

    it('warns for unknown events at any level', () => {
      const { send } = run(() => injectActor(authMachine));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      send({ type: 'UNKNOWN' } as never);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('strict mode', () => {
    it('throws on unknown event type', () => {
      const machine = createTypedMachine({
        events: { ON: null, OFF: null },
        strict: true,
      }).create({
        id: 'strictToggle',
        initial: 'off',
        states: {
          off: { on: { ON: 'on' } },
          on: { on: { OFF: 'off' } },
        },
      });

      const { send } = run(() => injectActor(machine));
      expect(() => {
        send({ type: 'NOPE' } as never);
      }).toThrow();
    });
  });

  describe('context schema', () => {
    it('types and validates context', () => {
      const machine = createTypedMachine({
        context: z.object({ count: z.number() }),
        events: { INC: null },
      }).create({
        id: 'withContext',
        context: { count: 0 },
        on: {
          INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        },
      });

      const { snapshot, send } = run(() => injectActor(machine));
      send({ type: 'INC' });
      expect(snapshot().context.count).toBe(1);
    });
  });

  describe('parallel states — 全領域のイベントを集約', () => {
    const playerMachine = createTypedMachine({
      events: { PLAY: null, PAUSE: null, MUTE: null, UNMUTE: null },
    }).create({
      id: 'player',
      type: 'parallel',
      states: {
        playback: {
          initial: 'paused',
          states: {
            paused: { on: { PLAY: 'playing' } },
            playing: { on: { PAUSE: 'paused' } },
          },
        },
        volume: {
          initial: 'unmuted',
          states: {
            unmuted: { on: { MUTE: 'muted' } },
            muted: { on: { UNMUTE: 'unmuted' } },
          },
        },
      },
    });

    it('sends events to parallel state regions', () => {
      const { snapshot, send } = run(() => injectActor(playerMachine));

      send({ type: 'PLAY' });
      send({ type: 'MUTE' });

      expect(snapshot().value).toEqual({ playback: 'playing', volume: 'muted' });
    });
  });
});
