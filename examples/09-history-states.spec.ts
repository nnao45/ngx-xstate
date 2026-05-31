/**
 * 09: History States — 前の状態への復帰
 *
 * history state は「最後にいた状態」を記憶する特殊な状態。
 * 割り込みから戻るときに元の状態に自動で復帰できる。
 *
 * createTypedMachine: NEXT / BACK / OPEN_SETTINGS / CLOSE を自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTypedMachine, noPayload, injectActor } from '../src/public-api';

const wizardMachine = createTypedMachine({
  events: { NEXT: noPayload, BACK: noPayload, OPEN_SETTINGS: noPayload, CLOSE: noPayload },
}).create({
  id: 'wizard',
  initial: 'wizard',
  states: {
    wizard: {
      initial: 'step1',
      states: {
        step1: { on: { NEXT: 'step2' } },
        step2: { on: { NEXT: 'step3', BACK: 'step1' } },
        step3: { on: { BACK: 'step2' } },
        hist: { type: 'history' },
      },
      on: {
        OPEN_SETTINGS: 'settings',
      },
    },
    settings: {
      on: {
        // history state に遷移 → 最後にいたステップに戻る
        CLOSE: 'wizard.hist',
      },
    },
  },
});

describe('09: History States — Wizard with interruption', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts at wizard.step1', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(wizardMachine));
    expect(snapshot().value).toEqual({ wizard: 'step1' });
  });

  it('returns to step1 when no history exists yet', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(wizardMachine));

    send({ type: 'OPEN_SETTINGS' });
    send({ type: 'CLOSE' });

    // 履歴がなければ initial state (step1) に戻る
    expect(snapshot().value).toEqual({ wizard: 'step1' });
  });

  it('returns to step2 when interrupted at step2', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(wizardMachine));

    send({ type: 'NEXT' }); // step2 へ
    send({ type: 'OPEN_SETTINGS' });
    send({ type: 'CLOSE' });

    // history state が step2 を記憶していた
    expect(snapshot().value).toEqual({ wizard: 'step2' });
  });

  it('returns to step3 when interrupted at step3', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(wizardMachine));

    send({ type: 'NEXT' }); // step2
    send({ type: 'NEXT' }); // step3
    send({ type: 'OPEN_SETTINGS' });
    send({ type: 'CLOSE' });

    expect(snapshot().value).toEqual({ wizard: 'step3' });
  });

  it('updates history on each navigation', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(wizardMachine));

    send({ type: 'NEXT' }); // step2
    send({ type: 'OPEN_SETTINGS' });
    send({ type: 'CLOSE' }); // step2 に戻る
    send({ type: 'NEXT' }); // step3 へ進む
    send({ type: 'OPEN_SETTINGS' });
    send({ type: 'CLOSE' }); // 今度は step3 に戻る

    expect(snapshot().value).toEqual({ wizard: 'step3' });
  });
});
