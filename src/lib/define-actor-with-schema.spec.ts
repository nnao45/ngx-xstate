import { describe, expect, it } from 'vitest';
import { assign, createMachine } from 'xstate';
import { z } from 'zod';
import { defineActorWithSchema, getSchemas } from './define-actor-with-schema';

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

const contextSchema = z.object({ count: z.number() });
const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('INCREMENT') }),
  z.object({ type: z.literal('DECREMENT') }),
]);

describe('defineActorWithSchema', () => {
  it('returns an object that still works as actor logic', () => {
    const schematized = defineActorWithSchema(counterMachine, {
      context: contextSchema,
      events: eventSchema,
    });
    expect(schematized).toBeDefined();
    expect(typeof schematized.transition).toBe('function');
  });

  it('attaches schemas retrievable by getSchemas', () => {
    const schematized = defineActorWithSchema(counterMachine, {
      context: contextSchema,
      events: eventSchema,
      strict: false,
    });
    const schemas = getSchemas(schematized);
    expect(schemas).toBeDefined();
    expect(schemas?.context).toBe(contextSchema);
    expect(schemas?.events).toBe(eventSchema);
    expect(schemas?.strict).toBe(false);
  });

  it('defaults strict to false', () => {
    const schematized = defineActorWithSchema(counterMachine, {
      events: eventSchema,
    });
    expect(getSchemas(schematized)?.strict).toBe(false);
  });

  it('respects strict: true', () => {
    const schematized = defineActorWithSchema(counterMachine, {
      events: eventSchema,
      strict: true,
    });
    expect(getSchemas(schematized)?.strict).toBe(true);
  });

  it('returns undefined schemas for plain actor logic', () => {
    expect(getSchemas(counterMachine)).toBeUndefined();
  });

  it('supports input schema', () => {
    const inputSchema = z.object({ userId: z.string() });
    const schematized = defineActorWithSchema(counterMachine, {
      input: inputSchema,
    });
    expect(getSchemas(schematized)?.input).toBe(inputSchema);
  });

  it('does not mutate the original logic', () => {
    const schematized = defineActorWithSchema(counterMachine, { events: eventSchema });
    expect(getSchemas(counterMachine)).toBeUndefined();
    expect(getSchemas(schematized)).toBeDefined();
  });
});
