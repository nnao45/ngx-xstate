import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { noPayload, typedSetup } from '@zstate/core';
import { useActor } from './use-actor';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload, SET: z.object({ value: z.number() }) },
}).createMachine({
  id: 'counter',
  context: { count: 0 },
  on: {
    INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    SET: { actions: assign({ count: ({ event }) => event.value }) },
  },
});

const fetchMachine = typedSetup({
  context: z.object({ retries: z.number() }),
  events: { FETCH: noPayload, RESOLVE: noPayload, CANCEL: noPayload },
}).createMachine({
  id: 'fetch',
  context: { retries: 0 },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: { on: { RESOLVE: 'success', CANCEL: 'idle' } },
    success: {},
  },
});

const auth = typedSetup({
  events: { LOGIN: noPayload, LOGOUT: noPayload, GO_IDLE: noPayload, WAKE_UP: noPayload },
}).createMachine({
  id: 'auth',
  initial: 'loggedOut',
  states: {
    loggedOut: { on: { LOGIN: 'loggedIn' } },
    loggedIn: {
      initial: 'active',
      states: { active: { on: { GO_IDLE: 'away' } }, away: { on: { WAKE_UP: 'active' } } },
      on: { LOGOUT: 'loggedOut' },
    },
  },
});

describe('useActor', () => {
  it('exposes the initial snapshot', () => {
    const { result } = renderHook(() => useActor(counter));
    expect(result.current.snapshot.context.count).toBe(0);
  });

  it('re-renders with the new snapshot on a valid send', () => {
    const { result } = renderHook(() => useActor(counter));
    act(() => {
      result.current.send({ type: 'INC' });
    });
    expect(result.current.snapshot.context.count).toBe(1);
  });

  it('validates payload events against the Zod schema', () => {
    const { result } = renderHook(() => useActor(counter));
    act(() => {
      result.current.send({ type: 'SET', value: 42 });
    });
    expect(result.current.snapshot.context.count).toBe(42);
  });

  it('warns and no-ops on an invalid event (strict: false default)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useActor(counter));
    act(() => {
      result.current.send({ type: 'SET', value: 'nope' } as never);
    });
    expect(result.current.snapshot.context.count).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('throws on an invalid event in strict mode', () => {
    const strict = typedSetup({
      context: z.object({ count: z.number() }),
      events: { SET: z.object({ value: z.number() }) },
      strict: true,
    }).createMachine({
      id: 'strict',
      context: { count: 0 },
      on: { SET: { actions: assign({ count: ({ event }) => event.value }) } },
    });
    const { result } = renderHook(() => useActor(strict));
    expect(() => {
      act(() => {
        result.current.send({ type: 'SET', value: 'bad' } as never);
      });
    }).toThrow();
  });

  describe('.in / .within', () => {
    it('runs the matching branch and sends a state-valid event', () => {
      const { result } = renderHook(() => useActor(fetchMachine));
      let ran = '';
      act(() => {
        result.current.in('idle', (idle) => {
          ran = idle.value;
          idle.send({ type: 'FETCH' });
        });
      });
      expect(ran).toBe('idle');
      expect(result.current.snapshot.value).toBe('loading');
    });

    it('descends into a nested state via within', () => {
      const { result } = renderHook(() => useActor(auth));
      act(() => {
        result.current.send({ type: 'LOGIN' });
      });
      let ran = false;
      act(() => {
        result.current.within('loggedIn', (s) =>
          s.in('active', (active) => {
            ran = true;
            active.send({ type: 'GO_IDLE' });
          }),
        );
      });
      expect(ran).toBe(true);
      expect(result.current.snapshot.value).toEqual({ loggedIn: 'away' });
    });
  });
});
