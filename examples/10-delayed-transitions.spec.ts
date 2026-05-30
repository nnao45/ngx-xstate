/**
 * 10: Delayed Transitions — 時間による自動遷移
 *
 * after() で一定時間後に自動で状態遷移させられる。
 * タイムアウト、自動ログアウト、トースト通知の非表示など。
 *
 * createTypedMachine: SHOW / DISMISS / LOGIN / ACTIVITY を自動推論。
 * テストでは vi.useFakeTimers() でタイマーを制御する。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTypedMachine, injectActor } from '../src/public-api';

const toastMachine = createTypedMachine({
  id: 'toast',
  initial: 'hidden',
  states: {
    hidden: { on: { SHOW: 'visible' } },
    visible: {
      after: { 3000: 'hidden' },
      on: { DISMISS: 'hidden' },
    },
  },
});

const sessionMachine = createTypedMachine({
  id: 'session',
  initial: 'active',
  states: {
    active: {
      after: { 5000: 'expired' },
      on: { ACTIVITY: 'active' },
    },
    expired: {
      on: { LOGIN: 'active' },
    },
  },
});

describe('10: Delayed Transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('toast notification', () => {
    it('starts hidden', () => {
      const { snapshot } = TestBed.runInInjectionContext(() => injectActor(toastMachine));
      expect(snapshot().value).toBe('hidden');
    });

    it('shows on SHOW event', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(toastMachine));

      send({ type: 'SHOW' });

      expect(snapshot().value).toBe('visible');
    });

    it('auto-hides after 3 seconds', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(toastMachine));

      send({ type: 'SHOW' });
      vi.advanceTimersByTime(3000);

      expect(snapshot().value).toBe('hidden');
    });

    it('stays visible before 3 seconds elapse', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(toastMachine));

      send({ type: 'SHOW' });
      vi.advanceTimersByTime(2999);

      expect(snapshot().value).toBe('visible');
    });

    it('can be dismissed manually before timeout', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(toastMachine));

      send({ type: 'SHOW' });
      send({ type: 'DISMISS' });

      expect(snapshot().value).toBe('hidden');
    });
  });

  describe('session timeout', () => {
    it('expires after 5 seconds of inactivity', () => {
      const { snapshot } = TestBed.runInInjectionContext(() => injectActor(sessionMachine));

      vi.advanceTimersByTime(5000);

      expect(snapshot().value).toBe('expired');
    });

    it('ACTIVITY resets the timer', () => {
      const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(sessionMachine));

      vi.advanceTimersByTime(2000);
      expect(snapshot().value).toBe('active');

      // ACTIVITY でタイマーリセット — active に再入場し新しい5秒タイマーが始まる
      send({ type: 'ACTIVITY' });

      // さらに2秒経過 (リセット後2秒 < 5秒なので active のまま)
      vi.advanceTimersByTime(2000);
      expect(snapshot().value).toBe('active');
    });
  });
});
