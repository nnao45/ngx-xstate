/**
 * Production-mode behavior for provideXstateDevtools.
 *
 * isDevMode() is mocked to return false at the @angular/core module boundary,
 * simulating a production build. The rest of @angular/core is preserved so
 * TestBed and DI still work. This file is separate from devtools.spec.ts
 * because the mock applies to every test in the module.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import type * as AngularCore from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { InspectionEvent } from 'xstate';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof AngularCore>();
  return { ...actual, isDevMode: () => false };
});

// Imports must come AFTER vi.mock so they see the mocked isDevMode.
const { provideXstateDevtools } = await import('./devtools');
const { injectActor } = await import('./inject-actor');
const { createTypedMachine, noPayload } = await import('./typed-machine');

const machine = createTypedMachine({
  events: { GO: noPayload },
}).create({
  initial: 'a',
  states: { a: { on: { GO: 'b' } }, b: {} },
});

describe('provideXstateDevtools — production mode (isDevMode false)', () => {
  it('does not connect the inspector to actors', () => {
    const events: InspectionEvent[] = [];
    const inspector = {
      inspect: (e: InspectionEvent) => {
        events.push(e);
      },
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        // No-op: returns empty providers, so XSTATE_INSPECTOR is never registered
        provideXstateDevtools(inspector),
      ],
    });

    TestBed.runInInjectionContext(() => injectActor(machine));

    // Inspector was never wired up in production
    expect(events).toHaveLength(0);
  });

  it('actors still work normally without devtools', () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });

    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(machine));
    expect(snapshot().value).toBe('a');
    send({ type: 'GO' });
    expect(snapshot().value).toBe('b');
  });
});
