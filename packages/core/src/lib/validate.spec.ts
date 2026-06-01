import { describe, expect, it, vi } from 'vitest';
import { assign, createActor, createMachine } from 'xstate';
import { z } from 'zod';
import type { SchemasPayload } from './schemas';
import { validateAndSend } from './validate';

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

const eventSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('INCREMENT') })]);

function startCounter() {
  const actor = createActor(counterMachine);
  actor.start();
  return actor;
}

describe('validateAndSend', () => {
  it('sends valid events directly when no schema is provided', () => {
    const actor = startCounter();
    validateAndSend(actor, { type: 'INCREMENT' }, undefined);
    expect(actor.getSnapshot().context.count).toBe(1);
  });

  it('sends events that pass the schema', () => {
    const actor = startCounter();
    const schemas: SchemasPayload = {
      events: eventSchema,
      context: undefined,
      input: undefined,
      output: z.unknown(),
      strict: false,
    };
    validateAndSend(actor, { type: 'INCREMENT' }, schemas);
    expect(actor.getSnapshot().context.count).toBe(1);
  });

  it('no-ops and warns on an invalid event when strict=false', () => {
    const actor = startCounter();
    const schemas: SchemasPayload = {
      events: eventSchema,
      context: undefined,
      input: undefined,
      output: z.unknown(),
      strict: false,
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    validateAndSend(actor, { type: 'UNKNOWN' }, schemas);

    expect(actor.getSnapshot().context.count).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[@zstate/core] Invalid event:'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('throws on an invalid event when strict=true', () => {
    const actor = startCounter();
    const schemas: SchemasPayload = {
      events: eventSchema,
      context: undefined,
      input: undefined,
      output: z.unknown(),
      strict: true,
    };

    expect(() => {
      validateAndSend(actor, { type: 'UNKNOWN' }, schemas);
    }).toThrow();
  });
});
