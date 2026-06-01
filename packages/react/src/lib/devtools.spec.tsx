import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { XStateInspector } from '@zstate/core';
import { useDevtoolsInspect, XStateDevtoolsProvider } from './devtools';

afterEach(() => {
  vi.unstubAllEnvs();
});

function wrapWith(inspector: XStateInspector) {
  return ({ children }: { children: ReactNode }) => (
    <XStateDevtoolsProvider inspector={inspector}>{children}</XStateDevtoolsProvider>
  );
}

describe('XStateDevtoolsProvider / useDevtoolsInspect', () => {
  it('returns undefined without a provider', () => {
    const { result } = renderHook(() => useDevtoolsInspect());
    expect(result.current).toBeUndefined();
  });

  it('exposes a bound inspect fn when a provider is present', () => {
    const inspect = vi.fn();
    const { result } = renderHook(() => useDevtoolsInspect(), {
      wrapper: wrapWith({ inspect }),
    });
    expect(result.current).toBeTypeOf('function');
    result.current?.({ type: '@xstate.actor' } as never);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('no-ops in production (NODE_ENV=production)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const inspect = vi.fn();
    const { result } = renderHook(() => useDevtoolsInspect(), {
      wrapper: wrapWith({ inspect }),
    });
    expect(result.current).toBeUndefined();
  });
});
