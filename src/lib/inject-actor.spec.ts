import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createMachine } from 'xstate';
import { z } from 'zod';
import { createTypedMachine } from './typed-machine';
import { injectActor } from './inject-actor';

const counterMachine = createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) },
      },
    },
  },
});

// Zod スキーマ付き machine（createTypedMachine 経由）。strict 別に2つ。
function makeTypedCounter(strict: boolean) {
  return createTypedMachine({
    context: z.object({ count: z.number() }),
    events: { INCREMENT: null, DECREMENT: null },
    strict,
  }).create({
    id: 'typedCounter',
    initial: 'active',
    context: { count: 0 },
    states: {
      active: {
        on: {
          INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
          DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) },
        },
      },
    },
  });
}

function runInInjectionContext<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

describe('injectActor', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('returns snapshot, send, and actorRef', () => {
    const result = runInInjectionContext(() => injectActor(counterMachine));
    expect(result.snapshot).toBeDefined();
    expect(result.send).toBeDefined();
    expect(result.actorRef).toBeDefined();
  });

  it('snapshot reflects initial state', () => {
    const { snapshot } = runInInjectionContext(() => injectActor(counterMachine));
    expect(snapshot().context.count).toBe(0);
  });

  it('send updates snapshot', () => {
    const { snapshot, send } = runInInjectionContext(() => injectActor(counterMachine));
    send({ type: 'INCREMENT' });
    expect(snapshot().context.count).toBe(1);
    send({ type: 'DECREMENT' });
    expect(snapshot().context.count).toBe(0);
  });

  it('actorRef is the same actor as snapshot source', () => {
    const { actorRef, snapshot } = runInInjectionContext(() => injectActor(counterMachine));
    actorRef.send({ type: 'INCREMENT' });
    expect(snapshot().context.count).toBe(1);
  });

  it('actor stops on component destroy', () => {
    @Component({ template: '', standalone: true })
    class TestComponent {
      state = injectActor(counterMachine);
    }
    const fixture = TestBed.createComponent(TestComponent);
    const { actorRef } = fixture.componentInstance.state;
    fixture.destroy();
    expect(actorRef.getSnapshot().status).toBe('stopped');
  });

  describe('with Zod schema (strict: false)', () => {
    it('allows valid events', () => {
      const machine = makeTypedCounter(false);
      const { snapshot, send } = runInInjectionContext(() => injectActor(machine));
      send({ type: 'INCREMENT' });
      expect(snapshot().context.count).toBe(1);
    });

    it('warns and no-ops on invalid events', () => {
      const machine = makeTypedCounter(false);
      const { snapshot, send } = runInInjectionContext(() => injectActor(machine));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      send({ type: 'RESET' } as never);

      expect(snapshot().context.count).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('with Zod schema (strict: true)', () => {
    it('throws on invalid events', () => {
      const machine = makeTypedCounter(true);
      const { send } = runInInjectionContext(() => injectActor(machine));
      expect(() => {
        send({ type: 'RESET' } as never);
      }).toThrow();
    });
  });

  describe('dynamic input', () => {
    const machineWithInput = createMachine({
      types: {} as { input: { userId: string }; context: { userId: string } },
      id: 'withDynInput',
      initial: 'active',
      context: ({ input }) => ({ userId: input.userId }),
      states: { active: {} },
    });

    it('snapshot updates when function input signal changes', () => {
      @Component({
        selector: 'test-dynamic-actor',
        template: '',
        standalone: true,
      })
      class TestComponent {
        userId = signal('user-1');
        state = injectActor(machineWithInput, {
          input: () => ({ userId: this.userId() }),
        });
      }

      const fixture = TestBed.createComponent(TestComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.state.snapshot().context.userId).toBe('user-1');

      fixture.componentInstance.userId.set('user-2');
      TestBed.tick();

      expect(fixture.componentInstance.state.snapshot().context.userId).toBe('user-2');
    });

    it('actorRef getter reflects current actor after input change', () => {
      @Component({
        selector: 'test-actor-ref-dynamic',
        template: '',
        standalone: true,
      })
      class TestComponent {
        userId = signal('user-a');
        state = injectActor(machineWithInput, {
          input: () => ({ userId: this.userId() }),
        });
      }

      const fixture = TestBed.createComponent(TestComponent);
      fixture.detectChanges();

      fixture.componentInstance.userId.set('user-b');
      TestBed.tick();

      expect(fixture.componentInstance.state.actorRef.getSnapshot().context.userId).toBe('user-b');
    });

    it('send routes to current actor after input change', () => {
      const machineWithSend = createMachine({
        types: {} as {
          input: { userId: string };
          events: { type: 'INC' };
          context: { userId: string; count: number };
        },
        id: 'withDynSend',
        initial: 'active',
        context: ({ input }) => ({
          userId: input.userId,
          count: 0,
        }),
        states: {
          active: {
            on: {
              INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
            },
          },
        },
      });

      @Component({
        selector: 'test-send-dynamic',
        template: '',
        standalone: true,
      })
      class TestComponent {
        userId = signal('user-x');
        state = injectActor(machineWithSend, {
          input: () => ({ userId: this.userId() }),
        });
      }

      const fixture = TestBed.createComponent(TestComponent);
      fixture.detectChanges();

      fixture.componentInstance.userId.set('user-y');
      TestBed.tick();

      fixture.componentInstance.state.send({ type: 'INC' });
      expect(fixture.componentInstance.state.snapshot().context.count).toBe(1);
    });
  });
});
