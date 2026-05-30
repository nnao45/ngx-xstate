/**
 * 03: Context — 複雑なデータ管理
 *
 * context は単純なカウンターだけでなく、複数のフィールド、
 * オブジェクト、配列など任意のデータ構造を持てる。
 * assign() で部分更新・計算更新が可能。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, createMachine } from 'xstate';
import { injectActor } from '../src/public-api';

// フォームの入力値を状態として持つ machine
const formMachine = createMachine({
  id: 'form',
  context: {
    name: '',
    email: '',
    submitted: false,
  },
  initial: 'editing',
  states: {
    editing: {
      on: {
        SET_NAME:  { actions: assign({ name:  ({ event }: { event: { type: 'SET_NAME';  value: string } }) => event.value }) },
        SET_EMAIL: { actions: assign({ email: ({ event }: { event: { type: 'SET_EMAIL'; value: string } }) => event.value }) },
        SUBMIT: {
          target: 'submitted',
          actions: assign({ submitted: true }),
        },
      },
    },
    submitted: {
      // 送信後は編集不可
    },
  },
});

describe('03: Context — Form data management', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts with empty fields', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(formMachine));
    expect(snapshot().context.name).toBe('');
    expect(snapshot().context.email).toBe('');
  });

  it('updates name via SET_NAME event', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(formMachine));

    send({ type: 'SET_NAME', value: 'Alice' });

    expect(snapshot().context.name).toBe('Alice');
  });

  it('updates email independently from name', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(formMachine));

    send({ type: 'SET_NAME',  value: 'Alice' });
    send({ type: 'SET_EMAIL', value: 'alice@example.com' });

    // assign は部分更新 — 他のフィールドは変わらない
    expect(snapshot().context.name).toBe('Alice');
    expect(snapshot().context.email).toBe('alice@example.com');
  });

  it('transitions to submitted state on SUBMIT', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(formMachine));

    send({ type: 'SET_NAME',  value: 'Alice' });
    send({ type: 'SET_EMAIL', value: 'alice@example.com' });
    send({ type: 'SUBMIT' });

    expect(snapshot().value).toBe('submitted');
    expect(snapshot().context.submitted).toBe(true);
  });

  it('ignores SET_NAME in submitted state', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(formMachine));

    send({ type: 'SET_NAME', value: 'Alice' });
    send({ type: 'SUBMIT' });
    send({ type: 'SET_NAME', value: 'Bob' });

    // submitted state では SET_NAME が定義されていないため no-op
    expect(snapshot().context.name).toBe('Alice');
  });
});
