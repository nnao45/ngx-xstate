import { Component, isDevMode, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { createMachine, type InspectionEvent } from 'xstate';
import { createActorContext } from './create-actor-context';
import { provideXstateDevtools } from './devtools';
import { injectActor } from './inject-actor';
import { injectActorRef } from './inject-actor-ref';
import { typedSetup, noPayload } from './typed-machine';

const counterMachine = createMachine({
  id: 'devCounter',
  context: { count: 0 },
  initial: 'active',
  states: { active: { on: { INC: { actions: [] } } } },
});

const CounterContext = createActorContext(counterMachine);

describe('provideXstateDevtools', () => {
  describe('in dev mode (default in tests)', () => {
    it('isDevMode() is true in test environment', () => {
      // vitest runs in dev mode
      expect(isDevMode()).toBe(true);
    });

    it('injectActor() picks up global inspector automatically', () => {
      const events: InspectionEvent[] = [];
      const inspector = {
        inspect: (e: InspectionEvent) => {
          events.push(e);
        },
      };

      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection(), provideXstateDevtools(inspector)],
      });

      TestBed.runInInjectionContext(() => injectActor(counterMachine));

      // @xstate.actor event fires when actor starts
      expect(events.some((e) => e.type === '@xstate.actor')).toBe(true);
    });

    it('injectActorRef() picks up global inspector automatically', () => {
      const events: InspectionEvent[] = [];
      const inspector = {
        inspect: (e: InspectionEvent) => {
          events.push(e);
        },
      };

      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection(), provideXstateDevtools(inspector)],
      });

      TestBed.runInInjectionContext(() => injectActorRef(counterMachine));

      expect(events.some((e) => e.type === '@xstate.actor')).toBe(true);
    });

    it('per-actor inspect overrides global inspector', () => {
      const globalEvents: InspectionEvent[] = [];
      const perActorEvents: InspectionEvent[] = [];
      const globalInspector = {
        inspect: (e: InspectionEvent) => {
          globalEvents.push(e);
        },
      };
      const perActorInspect = (e: InspectionEvent): void => {
        perActorEvents.push(e);
      };

      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection(), provideXstateDevtools(globalInspector)],
      });

      TestBed.runInInjectionContext(() =>
        injectActor(counterMachine, { inspect: perActorInspect }),
      );

      // Per-actor inspect fires, global does not (it was overridden)
      expect(perActorEvents.some((e) => e.type === '@xstate.actor')).toBe(true);
      expect(globalEvents).toHaveLength(0);
    });

    it('createActorContext.provideActor() picks up global inspector', () => {
      const events: InspectionEvent[] = [];
      const inspector = {
        inspect: (e: InspectionEvent) => {
          events.push(e);
        },
      };

      @Component({
        selector: 'test-ctx-devtools',
        template: '',
        standalone: true,
        providers: [CounterContext.provideActor()],
      })
      class TestComponent {
        actor = CounterContext.injectActorRef();
      }

      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection(), provideXstateDevtools(inspector)],
      });

      TestBed.createComponent(TestComponent);

      expect(events.some((e) => e.type === '@xstate.actor')).toBe(true);
    });

    it('works without provideXstateDevtools (inspector is optional)', () => {
      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection()],
      });

      expect(() => {
        TestBed.runInInjectionContext(() => injectActor(counterMachine));
      }).not.toThrow();
    });

    it('accepts any object with inspect method (not just @statelyai/inspect)', () => {
      const calls: string[] = [];
      const customInspector = {
        inspect: (e: InspectionEvent) => {
          calls.push(e.type);
        },
      };

      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection(), provideXstateDevtools(customInspector)],
      });

      TestBed.runInInjectionContext(() =>
        injectActor(
          typedSetup({ events: { GO: noPayload } }).createMachine({
            initial: 'a',
            states: { a: { on: { GO: 'b' } }, b: {} },
          }),
        ),
      );

      expect(calls.length).toBeGreaterThan(0);
    });
  });

  // Production no-op behavior is verified in devtools-production.spec.ts,
  // which mocks isDevMode() to return false at the module boundary.
});
