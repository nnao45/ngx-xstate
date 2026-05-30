import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, createActor, createMachine } from 'xstate';
import { injectSelector } from './inject-selector';

const counterMachine = createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0, label: 'counter' },
  states: {
    active: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        SET_LABEL: {
          actions: assign({
            label: ({ event }: { event: { type: 'SET_LABEL'; value: string } }) => event.value,
          }),
        },
      },
    },
  },
});

function runInInjectionContext<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

describe('injectSelector', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('returns initial selected value', () => {
    const actor = createActor(counterMachine).start();
    const count = runInInjectionContext(() => injectSelector(actor, (s) => s.context.count));
    expect(count()).toBe(0);
  });

  it('updates signal when selected value changes', () => {
    const actor = createActor(counterMachine).start();
    const count = runInInjectionContext(() => injectSelector(actor, (s) => s.context.count));

    actor.send({ type: 'INCREMENT' });
    expect(count()).toBe(1);

    actor.send({ type: 'INCREMENT' });
    expect(count()).toBe(2);
  });

  it('signal value does not change when selected value is unchanged', () => {
    const actor = createActor(counterMachine).start();

    const count = runInInjectionContext(() => injectSelector(actor, (s) => s.context.count));

    const valueBefore = count();
    actor.send({ type: 'SET_LABEL', value: 'new label' });
    // count did not change → Signal value stays the same reference
    expect(count()).toBe(0);
    expect(count()).toBe(valueBefore);
  });

  it('returns a readonly signal', () => {
    const actor = createActor(counterMachine).start();
    const selected = runInInjectionContext(() => injectSelector(actor, (s) => s.context.count));
    expect('set' in selected).toBe(false);
    expect('update' in selected).toBe(false);
  });

  it('applies shallow equal by default for object selection', () => {
    const actor = createActor(counterMachine).start();

    const ctx = runInInjectionContext(() => injectSelector(actor, (s) => s.context));

    const before = ctx();
    actor.send({ type: 'INCREMENT' });
    // After increment, context object is new reference but shallowEqual detects count changed
    expect(ctx().count).toBe(1);
    expect(ctx()).not.toBe(before);
  });
});
