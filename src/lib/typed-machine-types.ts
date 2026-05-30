import type { z } from 'zod';

// Any config shape that may have `on` and `states`
export interface AnyStateConfig {
  on?: Record<string, unknown>;
  states?: Record<string, AnyStateConfig>;
  type?: string;
}

// Extract string keys from a single state node's `on` object
type ExtractOnKeys<T> = T extends { on: infer On } ? keyof On & string : never;

// Recursively extract `on` keys from all nested states
type ExtractFromStates<T> = T extends { states: infer States }
  ? States extends Record<string, AnyStateConfig>
    ? { [K in keyof States]: ExtractOnKeys<States[K]> | ExtractFromStates<States[K]> }[keyof States]
    : never
  : never;

// Union of all event type strings defined anywhere in the machine config
export type AllEventKeys<T> = ExtractOnKeys<T> | ExtractFromStates<T>;

// Payload schemas must be ZodObject so they can be merged with { type: z.literal(key) }
export type PayloadSchemas = Record<string, z.ZodObject<z.ZodRawShape>>;

// Build the final event union type:
// - keys listed in TPayloads get { type: K } & z.infer<TPayloads[K]>
// - remaining keys get { type: K } (no extra fields)
export type TypedEventUnion<
  TKeys extends string,
  TPayloads extends Partial<Record<string, z.ZodObject<z.ZodRawShape>>>,
> = {
  [K in TKeys]: K extends keyof TPayloads
    ? TPayloads[K] extends z.ZodObject<z.ZodRawShape>
      ? { type: K } & z.infer<TPayloads[K]>
      : { type: K }
    : { type: K };
}[TKeys];
