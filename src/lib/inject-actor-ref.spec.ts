import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createMachine } from 'xstate';
import { z } from 'zod';
import { defineActorWithSchema } from './define-actor-with-schema';
import { injectActorRef, validateAndSend } from './inject-actor-ref';

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

const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('INCREMENT') }),
]);

function runInInjectionContext<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => { result = fn(); });
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
      id: 'withInput',
      initial: 'active',
      context: ({ input }: { input: { count: number } }) => ({ count: input.count }),
      states: { active: {} },
    });

    const actor = runInInjectionContext(() =>
      injectActorRef(machineWithInput, { input: { count: 42 } }),
    );
    expect(actor.getSnapshot().context.count).toBe(42);
  });

  it('passes function-form input to actor (resolves on creation)', () => {
    const machineWithInput = createMachine({
      id: 'withFnInput',
      initial: 'active',
      context: ({ input }: { input: { count: number } }) => ({ count: input.count }),
      states: { active: {} },
    });

    const actor = runInInjectionContext(() =>
      injectActorRef(machineWithInput, { input: () => ({ count: 99 }) }),
    );
    expect(actor.getSnapshot().context.count).toBe(99);
  });


  it('warns on invalid input when strict=false', () => {
    const inputSchema = z.object({ count: z.number() });
    const schematized = defineActorWithSchema(counterMachine, {
      input: inputSchema,
      strict: false,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    runInInjectionContext(() =>
      injectActorRef(schematized, { input: { count: 'not-a-number' } as unknown as never }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ngx-xstate] Invalid input:'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('throws on invalid input when strict=true', () => {
    const inputSchema = z.object({ count: z.number() });
    const schematized = defineActorWithSchema(counterMachine, {
      input: inputSchema,
      strict: true,
    });

    expect(() =>
      runInInjectionContext(() =>
        injectActorRef(schematized, { input: { count: 'bad' } as unknown as never }),
      ),
    ).toThrow();
  });
});

describe('validateAndSend', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('sends valid events directly', () => {
    const actor = runInInjectionContext(() => injectActorRef(counterMachine));
    validateAndSend(actor, { type: 'INCREMENT' }, undefined);
    expect(actor.getSnapshot().context.count).toBe(1);
  });

  it('no-ops on invalid event when strict=false', () => {
    const schematized = defineActorWithSchema(counterMachine, {
      events: eventSchema,
      strict: false,
    });
    const actor = runInInjectionContext(() => injectActorRef(schematized));
    const schemas = { events: eventSchema, context: undefined, input: undefined, strict: false };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    validateAndSend(actor, { type: 'UNKNOWN' }, schemas);

    expect(actor.getSnapshot().context.count).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('throws on invalid event when strict=true', () => {
    const actor = runInInjectionContext(() => injectActorRef(counterMachine));
    const schemas = { events: eventSchema, context: undefined, input: undefined, strict: true };

    expect(() => {
      validateAndSend(actor, { type: 'UNKNOWN' }, schemas);
    }).toThrow();
  });

  it('skips validation when no event schema provided', () => {
    const actor = runInInjectionContext(() => injectActorRef(counterMachine));
    expect(() => {
      validateAndSend(actor, { type: 'INCREMENT' }, undefined);
    }).not.toThrow();
  });
});
