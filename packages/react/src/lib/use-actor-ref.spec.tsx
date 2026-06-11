import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { assign, createMachine, type InspectionEvent } from 'xstate';
import { z } from 'zod';
import { typedSetup } from '@zstate/core';
import { buildActorOptions, useActorRef } from './use-actor-ref';
import { XStateDevtoolsProvider } from './devtools';

const counter = createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: { INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
    },
  },
});

const withInput = typedSetup({
  context: z.object({ count: z.number() }),
  input: z.object({ count: z.number() }),
  events: {},
}).createMachine({
  id: 'withInput',
  context: ({ input }) => ({ count: input.count }),
  initial: 'active',
  states: { active: {} },
});

describe('buildActorOptions', () => {
  it('prefers per-actor inspect over the global inspector', () => {
    const local = vi.fn();
    const global = vi.fn();
    const opts = buildActorOptions<typeof withInput>({ inspect: local }, { count: 1 }, global) as {
      inspect?: (e: InspectionEvent) => void;
      input?: unknown;
    };
    expect(opts.inspect).toBe(local);
    expect(opts.input).toEqual({ count: 1 });
  });

  it('falls back to the global inspector when none is given', () => {
    const global = vi.fn();
    const opts = buildActorOptions<typeof counter>(undefined, undefined, global) as {
      inspect?: (e: InspectionEvent) => void;
    };
    expect(opts.inspect).toBe(global);
  });

  it('passes id / systemId / snapshot through', () => {
    const opts = buildActorOptions<typeof counter>(
      { id: 'x', systemId: 'y' },
      undefined,
    ) as {
      id?: string;
      systemId?: string;
      inspect?: unknown;
    };
    expect(opts.id).toBe('x');
    expect(opts.systemId).toBe('y');
    expect(opts.inspect).toBeUndefined();
  });
});

describe('useActorRef', () => {
  it('returns a started actor and stops it on unmount', () => {
    const { result, unmount } = renderHook(() => useActorRef(counter));
    expect(result.current.getSnapshot().status).toBe('active');
    unmount();
    expect(result.current.getSnapshot().status).toBe('stopped');
  });

  it('forwards events to the actor', () => {
    const { result } = renderHook(() => useActorRef(counter));
    act(() => {
      result.current.send({ type: 'INCREMENT' });
    });
    expect(result.current.getSnapshot().context.count).toBe(1);
  });

  it('passes static input', () => {
    const { result } = renderHook(() => useActorRef(withInput, { input: { count: 42 } }));
    expect(result.current.getSnapshot().context.count).toBe(42);
  });

  it('warns on invalid input when strict=false', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderHook(() => useActorRef(withInput, { input: { count: 'bad' } as unknown as never }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[@zstate/react] Invalid input:'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('throws on invalid input when strict=true', () => {
    const strictInput = typedSetup({
      context: z.object({ count: z.number() }),
      input: z.object({ count: z.number() }),
      events: {},
      strict: true,
    }).createMachine({
      id: 'strictInput',
      context: ({ input }) => ({ count: input.count }),
      initial: 'active',
      states: { active: {} },
    });
    expect(() =>
      renderHook(() => useActorRef(strictInput, { input: { count: 'bad' } as unknown as never })),
    ).toThrow();
  });

  it('survives StrictMode double-mount with a live actor', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useActorRef(counter), { wrapper });
    expect(result.current.getSnapshot().status).toBe('active');
    act(() => {
      result.current.send({ type: 'INCREMENT' });
    });
    expect(result.current.getSnapshot().context.count).toBe(1);
  });

  it('auto-connects the global devtools inspector', () => {
    const events: InspectionEvent[] = [];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <XStateDevtoolsProvider inspector={{ inspect: (e) => events.push(e) }}>
        {children}
      </XStateDevtoolsProvider>
    );
    renderHook(() => useActorRef(counter), { wrapper });
    expect(events.some((e) => e.type === '@xstate.actor')).toBe(true);
  });
});
