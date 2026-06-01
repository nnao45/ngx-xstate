import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createMachine } from 'xstate';
import { z } from 'zod';
import { typedSetup } from '@zstate/core';
import { injectActorRef } from './inject-actor-ref';

const counterMachine = createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
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

describe('injectActorRef', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('returns a started actor', () => {
    const actor = runInInjectionContext(() => injectActorRef(counterMachine));
    expect(actor.getSnapshot().value).toBe('active');
  });

  it('actor stops when component is destroyed', () => {
    @Component({ template: '', standalone: true })
    class TestComponent {
      actor = injectActorRef(counterMachine);
    }
    const fixture = TestBed.createComponent(TestComponent);
    const actor = fixture.componentInstance.actor;
    expect(actor.getSnapshot().status).toBe('active');
    fixture.destroy();
    expect(actor.getSnapshot().status).toBe('stopped');
  });

  it('passes static input to actor', () => {
    const machineWithInput = createMachine({
      types: {} as { input: { count: number }; context: { count: number } },
      id: 'withInput',
      initial: 'active',
      context: ({ input }) => ({ count: input.count }),
      states: { active: {} },
    });

    const actor = runInInjectionContext(() =>
      injectActorRef(machineWithInput, { input: { count: 42 } }),
    );
    expect(actor.getSnapshot().context.count).toBe(42);
  });

  it('passes function-form input to actor (resolves on creation)', () => {
    const machineWithInput = createMachine({
      types: {} as { input: { count: number }; context: { count: number } },
      id: 'withFnInput',
      initial: 'active',
      context: ({ input }) => ({ count: input.count }),
      states: { active: {} },
    });

    const actor = runInInjectionContext(() =>
      injectActorRef(machineWithInput, { input: () => ({ count: 99 }) }),
    );
    expect(actor.getSnapshot().context.count).toBe(99);
  });

  it('warns on invalid input when strict=false', () => {
    const machine = typedSetup({
      context: z.object({ count: z.number() }),
      input: z.object({ count: z.number() }),
      events: {},
    }).createMachine({
      id: 'inputWarn',
      context: ({ input }) => ({ count: input.count }),
      initial: 'active',
      states: { active: {} },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    runInInjectionContext(() =>
      injectActorRef(machine, { input: { count: 'not-a-number' } as unknown as never }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[@zstate/ngx] Invalid input:'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('throws on invalid input when strict=true', () => {
    const machine = typedSetup({
      context: z.object({ count: z.number() }),
      input: z.object({ count: z.number() }),
      events: {},
      strict: true,
    }).createMachine({
      id: 'inputThrow',
      context: ({ input }) => ({ count: input.count }),
      initial: 'active',
      states: { active: {} },
    });

    expect(() =>
      runInInjectionContext(() =>
        injectActorRef(machine, { input: { count: 'bad' } as unknown as never }),
      ),
    ).toThrow();
  });
});
