/** 09: Zod ランタイム検証 — strict で throw、デフォルトで warn + no-op */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { typedSetup, useActor } from '../src/public-api';

const strictForm = typedSetup({
  context: z.object({ email: z.string() }),
  events: { SET_EMAIL: z.object({ value: z.string().email() }) },
  strict: true,
}).createMachine({
  id: 'strictForm',
  context: { email: '' },
  on: { SET_EMAIL: { actions: assign({ email: ({ event }) => event.value }) } },
});

const lenientForm = typedSetup({
  context: z.object({ email: z.string() }),
  events: { SET_EMAIL: z.object({ value: z.string().email() }) },
}).createMachine({
  id: 'lenientForm',
  context: { email: '' },
  on: { SET_EMAIL: { actions: assign({ email: ({ event }) => event.value }) } },
});

describe('09: Zod validation', () => {
  it('throws on an invalid payload in strict mode', () => {
    const { result } = renderHook(() => useActor(strictForm));
    expect(() => {
      act(() => {
        result.current.send({ type: 'SET_EMAIL', value: 'not-an-email' });
      });
    }).toThrow();
  });

  it('accepts a valid payload', () => {
    const { result } = renderHook(() => useActor(strictForm));
    act(() => {
      result.current.send({ type: 'SET_EMAIL', value: 'a@b.com' });
    });
    expect(result.current.snapshot.context.email).toBe('a@b.com');
  });

  it('warns and no-ops on an invalid payload by default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useActor(lenientForm));
    act(() => {
      result.current.send({ type: 'SET_EMAIL', value: 'bad' });
    });
    expect(result.current.snapshot.context.email).toBe('');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
