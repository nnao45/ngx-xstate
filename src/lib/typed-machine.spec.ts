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

// ─── Basic machine (no payloads) ─────────────────────────────────────────────

const toggleMachine = createTypedMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { on: { TOGGLE: 'inactive' } },
  },
});

// ─── Machine with payloads ────────────────────────────────────────────────────

const counterMachine = createTypedMachine(
  {
    id: 'counter',
    context: { count: 0 },
    on: {
      INCREMENT: {
        actions: assign({
          count: ({ context }: { context: { count: number } }) => context.count + 1,
        }),
      },
      DECREMENT: {
        actions: assign({
          count: ({ context }: { context: { count: number } }) => context.count - 1,
        }),
      },
      SET: {
        actions: assign({
          count: ({ event }: { event: { type: 'SET'; value: number } }) => event.value,
        }),
      },
    },
  },
  {
    payloads: {
      SET: z.object({ value: z.number() }),
    },
  },
);

// ─── Nested machine ───────────────────────────────────────────────────────────

const authMachine = createTypedMachine({
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

      // value should be number, not string
      send({ type: 'SET', value: 'not-a-number' } as never);

      expect(snapshot().context.count).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws on invalid payload in strict mode', () => {
      const strictMachine = createTypedMachine(
        {
          id: 'strict',
          context: { value: 0 },
          on: {
            SET: {
              actions: assign({
                value: ({ event }: { event: { type: 'SET'; n: number } }) => event.n,
              }),
            },
          },
        },
        {
          payloads: { SET: z.object({ n: z.number() }) },
          strict: true,
        },
      );

      const { send } = run(() => injectActor(strictMachine));
      expect(() => {
        send({ type: 'SET', n: 'bad' } as never);
      }).toThrow();
    });
  });

  describe('nested state — AllEventKeys collects across all levels', () => {
    it('collects events from top-level and nested states', () => {
      const { snapshot, send } = run(() => injectActor(authMachine));

      // top-level event
      send({ type: 'LOGIN' });
      expect(snapshot().matches('loggedIn')).toBe(true);

      // nested event (inside loggedIn)
      send({ type: 'GO_IDLE' });
      expect(snapshot().value).toEqual({ loggedIn: 'idle' });

      // nested event (inside loggedIn.idle)
      send({ type: 'WAKE_UP' });
      expect(snapshot().value).toEqual({ loggedIn: 'active' });

      // back to top
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
      const machine = createTypedMachine(
        {
          id: 'strictToggle',
          initial: 'off',
          states: {
            off: { on: { ON: 'on' } },
            on: { on: { OFF: 'off' } },
          },
        },
        { strict: true },
      );

      const { send } = run(() => injectActor(machine));
      expect(() => {
        send({ type: 'NOPE' } as never);
      }).toThrow();
    });
  });

  describe('context + input schemas', () => {
    it('validates context schema', () => {
      const machine = createTypedMachine(
        {
          id: 'withContext',
          context: { count: 0 },
          on: {
            INC: {
              actions: assign({
                count: ({ context }: { context: { count: number } }) => context.count + 1,
              }),
            },
          },
        },
        {
          context: z.object({ count: z.number() }),
        },
      );

      const { snapshot, send } = run(() => injectActor(machine));
      send({ type: 'INC' });
      expect(snapshot().context.count).toBe(1);
    });
  });

  describe('parallel states — collectOnKeys covers all regions', () => {
    const playerMachine = createTypedMachine({
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
