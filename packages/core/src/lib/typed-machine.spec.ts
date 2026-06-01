import { describe, expect, it, vi } from 'vitest';
import { assign, createActor, type AnyStateMachine } from 'xstate';
import { z } from 'zod';
import { noPayload, typedSetup } from './typed-machine';
import { getSchemas } from './schemas';
import { validateAndSend } from './validate';

// injectActor を介さず、core 単体（createActor + validateAndSend）で
// typedSetup の挙動（型付けされた machine + ランタイム検証）を検証する。
function drive(machine: AnyStateMachine) {
  const actor = createActor(machine);
  actor.start();
  const schemas = getSchemas(machine);
  const send = (event: { type: string } & Record<string, unknown>): void => {
    validateAndSend(actor, event as never, schemas);
  };
  return {
    actor,
    send,
    snapshot: () => actor.getSnapshot() as { value: unknown; context: Record<string, unknown> },
  };
}

// ─── 1 イベント（buildEventSchema: single 分岐） ────────────────────────────────
const toggleMachine = typedSetup({
  events: { TOGGLE: noPayload },
}).createMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { on: { TOGGLE: 'inactive' } },
  },
});

// ─── 複数イベント + payload（buildEventSchema: discriminatedUnion 分岐） ──────────
const counterMachine = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INCREMENT: noPayload, DECREMENT: noPayload, SET: z.object({ value: z.number() }) },
}).createMachine({
  id: 'counter',
  context: { count: 0 },
  on: {
    INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) },
    SET: { actions: assign({ count: ({ event }) => event.value }) },
  },
});

// ─── イベント未定義（buildEventSchema: empty 分岐 → { type: string }） ────────────
const looseMachine = typedSetup({
  events: {},
}).createMachine({
  id: 'loose',
  initial: 'a',
  states: { a: { on: { GO: 'b' } }, b: {} },
});

// ─── ネスト ──────────────────────────────────────────────────────────────────
const authMachine = typedSetup({
  events: { LOGIN: noPayload, LOGOUT: noPayload, GO_IDLE: noPayload, WAKE_UP: noPayload },
}).createMachine({
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

describe('typedSetup', () => {
  describe('basic toggle (single event)', () => {
    it('starts in initial state', () => {
      const { snapshot } = drive(toggleMachine);
      expect(snapshot().value).toBe('inactive');
    });

    it('transitions on TOGGLE', () => {
      const { snapshot, send } = drive(toggleMachine);
      send({ type: 'TOGGLE' });
      expect(snapshot().value).toBe('active');
    });

    it('warns and no-ops on unknown event (strict: false default)', () => {
      const { snapshot, send } = drive(toggleMachine);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      send({ type: 'UNKNOWN' });

      expect(snapshot().value).toBe('inactive');
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('machine with payloads (discriminatedUnion)', () => {
    it('accepts payload-less events', () => {
      const { snapshot, send } = drive(counterMachine);
      send({ type: 'INCREMENT' });
      expect(snapshot().context['count']).toBe(1);
    });

    it('accepts events with Zod-validated payloads', () => {
      const { snapshot, send } = drive(counterMachine);
      send({ type: 'SET', value: 42 });
      expect(snapshot().context['count']).toBe(42);
    });

    it('warns and no-ops when payload fails Zod validation', () => {
      const { snapshot, send } = drive(counterMachine);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      send({ type: 'SET', value: 'not-a-number' });

      expect(snapshot().context['count']).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws on invalid payload in strict mode', () => {
      const strictMachine = typedSetup({
        context: z.object({ value: z.number() }),
        events: { SET: z.object({ n: z.number() }) },
        strict: true,
      }).createMachine({
        id: 'strict',
        context: { value: 0 },
        on: {
          SET: { actions: assign({ value: ({ event }) => event.n }) },
        },
      });

      const { send } = drive(strictMachine);
      expect(() => {
        send({ type: 'SET', n: 'bad' } as never);
      }).toThrow();
    });
  });

  describe('empty events map → { type: string }', () => {
    it('falls back to a permissive event type and still transitions', () => {
      const { snapshot, send } = drive(looseMachine);
      send({ type: 'GO' });
      expect(snapshot().value).toBe('b');
    });
  });

  describe('nested state — events aggregated across levels', () => {
    it('collects events from top-level and nested states', () => {
      const { snapshot, send } = drive(authMachine);

      send({ type: 'LOGIN' });
      expect(snapshot().value).toEqual({ loggedIn: 'active' });

      send({ type: 'GO_IDLE' });
      expect(snapshot().value).toEqual({ loggedIn: 'idle' });

      send({ type: 'WAKE_UP' });
      expect(snapshot().value).toEqual({ loggedIn: 'active' });

      send({ type: 'LOGOUT' });
      expect(snapshot().value).toBe('loggedOut');
    });
  });

  describe('named actions / guards (params preserved) + output', () => {
    const stepper = typedSetup({
      context: z.object({ count: z.number() }),
      events: { STEP: z.object({ by: z.number() }) },
      output: z.object({ total: z.number() }),
      actions: {
        bump: assign({
          count: ({ context }, params: { amount: number }) => context.count + params.amount,
        }),
      },
      guards: {
        underMax: ({ context }, params: { max: number }) => context.count < params.max,
      },
    }).createMachine({
      id: 'stepper',
      context: { count: 0 },
      on: {
        STEP: {
          guard: { type: 'underMax', params: { max: 10 } },
          actions: { type: 'bump', params: { amount: 2 } },
        },
      },
    });

    it('runs a named guarded action with preserved params', () => {
      const { snapshot, send } = drive(stepper);
      send({ type: 'STEP', by: 1 });
      send({ type: 'STEP', by: 1 });
      expect(snapshot().context['count']).toBe(4);
    });

    it('attaches the output schema to the machine', () => {
      const schemas = getSchemas(stepper);
      expect(schemas?.output).toBeDefined();
      expect(schemas?.output.safeParse({ total: 1 }).success).toBe(true);
    });
  });

  describe('parallel states', () => {
    const playerMachine = typedSetup({
      events: { PLAY: noPayload, PAUSE: noPayload, MUTE: noPayload, UNMUTE: noPayload },
    }).createMachine({
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

    it('sends events to parallel regions', () => {
      const { snapshot, send } = drive(playerMachine);
      send({ type: 'PLAY' });
      send({ type: 'MUTE' });
      expect(snapshot().value).toEqual({ playback: 'playing', volume: 'muted' });
    });
  });
});
