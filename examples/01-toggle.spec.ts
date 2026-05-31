/**
 * 01: Toggle — 最もシンプルな状態機械
 *
 * 2つの状態 (inactive / active) を行き来する。
 * statecharts.dev の「基本的な状態機械」の概念そのもの。
 *
 * createTypedMachine: on キーから 'TOGGLE' を自動推論。
 * send({ type: 'TYPO' }) はコンパイルエラーになる。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTypedMachine, noPayload, injectActor } from '../src/public-api';

const toggleMachine = createTypedMachine({
  // payload なしイベントは null。これだけで send が 'TOGGLE' に型付けされる
  events: { TOGGLE: noPayload },
}).create({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { on: { TOGGLE: 'inactive' } },
  },
});

describe('01: Toggle', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts in inactive state', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(toggleMachine));
    expect(snapshot().value).toBe('inactive');
  });

  it('toggles to active on TOGGLE event', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(toggleMachine));

    send({ type: 'TOGGLE' });

    expect(snapshot().value).toBe('active');
  });

  it('toggles back to inactive on second TOGGLE', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(toggleMachine));

    send({ type: 'TOGGLE' });
    send({ type: 'TOGGLE' });

    expect(snapshot().value).toBe('inactive');
  });

  it('ignores unknown events (XState no-op behavior)', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(toggleMachine));

    send({ type: 'UNKNOWN' } as never);

    // 知らないイベントは無視される — XState のデフォルト動作
    expect(snapshot().value).toBe('inactive');
  });
});
