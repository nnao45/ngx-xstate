/**
 * 03: Context — 複雑なデータ管理
 *
 * context は単純なカウンターだけでなく、複数のフィールドを持てる。
 * assign() で部分更新・計算更新が可能。
 *
 * createTypedMachine: SET_NAME / SET_EMAIL はペイロードがあるので
 * payloads に Zod スキーマを追加。SUBMIT はペイロードなしで自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { createTypedMachine, injectActor } from '../src/public-api';

const formMachine = createTypedMachine({
  context: z.object({ name: z.string(), email: z.string(), submitted: z.boolean() }),
  events: {
    SET_NAME: z.object({ value: z.string() }),
    SET_EMAIL: z.object({ value: z.string().email() }),
    SUBMIT: null,
  },
}).create({
  id: 'form',
  context: { name: '', email: '', submitted: false },
  initial: 'editing',
  states: {
    editing: {
      on: {
        // event は遷移キーごとに自動 narrow。手動の型注釈は不要
        SET_NAME: { actions: assign({ name: ({ event }) => event.value }) },
        SET_EMAIL: { actions: assign({ email: ({ event }) => event.value }) },
        SUBMIT: { target: 'submitted', actions: assign({ submitted: true }) },
      },
    },
    submitted: {},
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

    send({ type: 'SET_NAME', value: 'Alice' });
    send({ type: 'SET_EMAIL', value: 'alice@example.com' });

    // assign は部分更新 — 他のフィールドは変わらない
    expect(snapshot().context.name).toBe('Alice');
    expect(snapshot().context.email).toBe('alice@example.com');
  });

  it('transitions to submitted state on SUBMIT', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(formMachine));

    send({ type: 'SET_NAME', value: 'Alice' });
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
