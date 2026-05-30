/**
 * 06: Async Invoke — 非同期処理の状態管理
 *
 * XState では Promise を "invoke" することで
 * 非同期処理を状態機械として管理できる。
 * loading → success/error の典型的なフェッチパターン。
 *
 * fromPromise() で Promise を actor として扱う。
 * createTypedMachine: FETCH / RESET / RETRY を on キーから自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, fromPromise } from 'xstate';
import { createTypedMachine, injectActor } from '../src/public-api';

interface User {
  id: number;
  name: string;
}

const fetchUserLogic = fromPromise<User, { userId: number }>(({ input }) =>
  Promise.resolve({ id: input.userId, name: `User ${input.userId}` }),
);

const fetchMachine = createTypedMachine({
  id: 'fetch',
  initial: 'idle',
  context: {
    user: null as User | null,
    error: null as string | null,
  },
  states: {
    idle: {
      on: { FETCH: 'loading' },
    },
    loading: {
      invoke: {
        src: fetchUserLogic,
        input: { userId: 1 },
        onDone: {
          target: 'success',
          actions: assign({ user: ({ event }) => event.output }),
        },
        onError: {
          target: 'error',
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
    },
    success: {
      on: {
        RESET: {
          target: 'idle',
          actions: assign({ user: null, error: null }),
        },
      },
    },
    error: {
      on: { RETRY: 'loading', RESET: 'idle' },
    },
  },
});

const failingFetchMachine = createTypedMachine({
  id: 'failingFetch',
  initial: 'loading',
  context: { error: null as string | null },
  states: {
    loading: {
      invoke: {
        src: fromPromise(() => Promise.reject(new Error('Network error'))),
        onDone: { target: 'success' },
        onError: {
          target: 'error',
          actions: assign({ error: ({ event }) => String(event.error) }),
        },
      },
    },
    success: {},
    error: {
      on: { RETRY: 'loading' },
    },
  },
});

describe('06: Async Invoke', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts in idle state', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(fetchMachine));
    expect(snapshot().value).toBe('idle');
  });

  it('transitions to loading on FETCH', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(fetchMachine));

    send({ type: 'FETCH' });

    expect(snapshot().value).toBe('loading');
  });

  it('transitions to success after Promise resolves', async () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(fetchMachine));

    send({ type: 'FETCH' });
    await Promise.resolve();

    expect(snapshot().value).toBe('success');
    expect(snapshot().context.user?.name).toBe('User 1');
  });

  it('can reset from success to idle', async () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(fetchMachine));

    send({ type: 'FETCH' });
    await Promise.resolve();
    send({ type: 'RESET' });

    expect(snapshot().value).toBe('idle');
    expect(snapshot().context.user).toBeNull();
  });

  it('transitions to error when Promise rejects', async () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(failingFetchMachine));

    await Promise.resolve();

    expect(snapshot().value).toBe('error');
    expect(snapshot().context.error).toContain('Network error');
  });

  it('can retry after error', async () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() =>
      injectActor(failingFetchMachine),
    );

    await Promise.resolve();
    expect(snapshot().value).toBe('error');

    send({ type: 'RETRY' });
    expect(snapshot().value).toBe('loading');
  });
});
