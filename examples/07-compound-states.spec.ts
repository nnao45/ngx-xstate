/**
 * 07: Compound States — 階層化された状態
 *
 * 状態の中に状態を持てる (nested states)。
 * 典型例: 認証フロー (loggedIn の中に idle/active がある)
 *
 * createTypedMachine: LOGIN はペイロード (username) があるので
 * payloads に追加。LOGOUT / GO_IDLE / WAKE_UP は自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { createTypedMachine, noPayload, injectActor } from '../src/public-api';

const authMachine = createTypedMachine({
  context: z.object({ username: z.string() }),
  events: {
    LOGIN: z.object({ username: z.string().min(1) }),
    LOGOUT: noPayload,
    GO_IDLE: noPayload,
    WAKE_UP: noPayload,
  },
}).create({
  id: 'auth',
  initial: 'loggedOut',
  context: { username: '' },
  states: {
    loggedOut: {
      on: {
        LOGIN: {
          target: 'loggedIn',
          actions: assign({ username: ({ event }) => event.username }),
        },
      },
    },
    loggedIn: {
      initial: 'active',
      states: {
        active: { on: { GO_IDLE: 'idle' } },
        idle: { on: { WAKE_UP: 'active' } },
      },
      on: {
        LOGOUT: {
          target: 'loggedOut',
          actions: assign({ username: '' }),
        },
      },
    },
  },
});

describe('07: Compound States — Authentication flow', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts logged out', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(authMachine));
    expect(snapshot().value).toBe('loggedOut');
  });

  it('transitions to loggedIn.active on LOGIN', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(authMachine));

    send({ type: 'LOGIN', username: 'alice' });

    expect(snapshot().value).toEqual({ loggedIn: 'active' });
    expect(snapshot().context.username).toBe('alice');
  });

  it('matches parent state with snapshot.matches()', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(authMachine));

    send({ type: 'LOGIN', username: 'alice' });

    // 親状態だけでマッチ — 子状態に関わらず true
    expect(snapshot().matches('loggedIn')).toBe(true);
  });

  it('navigates child states within loggedIn', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(authMachine));

    send({ type: 'LOGIN', username: 'alice' });
    send({ type: 'GO_IDLE' });

    expect(snapshot().value).toEqual({ loggedIn: 'idle' });
  });

  it('logs out from any child state', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(authMachine));

    send({ type: 'LOGIN', username: 'alice' });
    send({ type: 'GO_IDLE' });
    // idle 状態から直接 LOGOUT できる (親の遷移が子に引き継がれる)
    send({ type: 'LOGOUT' });

    expect(snapshot().value).toBe('loggedOut');
    expect(snapshot().context.username).toBe('');
  });
});
