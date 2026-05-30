import { createMachine } from 'xstate';
import { z, type ZodDiscriminatedUnionOption } from 'zod';
import { defineActorWithSchema } from './define-actor-with-schema';
import type {
  AnyStateConfig,
  AllEventKeys,
  PayloadSchemas,
  TypedEventUnion,
} from './typed-machine-types';

// ─── Runtime: collect all `on` keys recursively ──────────────────────────────

function collectOnKeys(config: AnyStateConfig, keys = new Set<string>()): Set<string> {
  if (config.on != null) {
    Object.keys(config.on).forEach((k) => keys.add(k));
  }

  if (config.states != null) {
    Object.values(config.states).forEach((child) => collectOnKeys(child, keys));
  }

  return keys;
}

// ─── Runtime: build discriminatedUnion Zod schema ────────────────────────────

type TypedEventSchema = z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>;

function buildEventSchema(
  onKeys: Set<string>,
  payloads: Partial<Record<string, z.ZodObject<z.ZodRawShape>>>,
): z.ZodTypeAny {
  const schemas = Array.from(onKeys).map((key): TypedEventSchema => {
    const payload = payloads[key];
    const base = z.object({ type: z.literal(key) });
    return (payload != null ? base.merge(payload) : base) as TypedEventSchema;
  });

  // Destructure + narrow so neither a non-null assertion nor an `as` cast
  // is needed to satisfy the discriminatedUnion's "at least two members" tuple.
  const [first, second, ...rest] = schemas;

  if (first === undefined) {
    // No `on` keys anywhere — fall back to an open event shape.
    return z.object({ type: z.string() });
  }

  if (second === undefined) {
    return first;
  }

  const duSchemas = [first, second, ...rest] as unknown as [
    ZodDiscriminatedUnionOption<'type'>,
    ZodDiscriminatedUnionOption<'type'>,
    ...ZodDiscriminatedUnionOption<'type'>[],
  ];

  return z.discriminatedUnion('type', duSchemas);
}

// ─── createTypedMachine ───────────────────────────────────────────────────────

export interface CreateTypedMachineOptions<
  TPayloads extends Partial<PayloadSchemas>,
  TContextSchema extends z.ZodTypeAny,
  TInputSchema extends z.ZodTypeAny,
> {
  readonly payloads?: TPayloads;
  readonly context?: TContextSchema;
  readonly input?: TInputSchema;
  readonly strict?: boolean;
}

// The return type is intentionally inferred, not annotated. An explicit
// annotation would have to reproduce XState's full MachineSnapshot generic
// (impractical) or collapse to AnyActorLogic — which makes SnapshotFrom<>
// resolve to `any` and breaks snapshot/send typing. Inference preserves it.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, @typescript-eslint/explicit-module-boundary-types
export function createTypedMachine<
  TConfig extends AnyStateConfig & Parameters<typeof createMachine>[0],
  TPayloads extends Partial<Record<AllEventKeys<TConfig> & string, z.ZodObject<z.ZodRawShape>>> = Record<never, never>,
  TContextSchema extends z.ZodTypeAny = z.ZodUnknown,
  TInputSchema extends z.ZodTypeAny = z.ZodUndefined,
>(
  config: TConfig,
  options?: CreateTypedMachineOptions<TPayloads, TContextSchema, TInputSchema>,
) {
  // createMachine receives TConfig directly — TypeScript infers the full machine type
  // (context, events, states) without any 'as' cast losing information
  const machine = createMachine(config);

  const onKeys = collectOnKeys(config);
  const payloads = (options?.payloads ?? {}) as Partial<Record<string, z.ZodObject<z.ZodRawShape>>>;
  const eventSchema = buildEventSchema(onKeys, payloads) as z.ZodType<
    TypedEventUnion<AllEventKeys<TConfig> & string, TPayloads>
  >;

  // Return type is inferred from defineActorWithSchema — preserves typeof machine
  // so SnapshotFrom<ReturnType<createTypedMachine>> is fully typed (not any)
  return defineActorWithSchema(machine, {
    events: eventSchema,
    context: options?.context,
    input: options?.input,
    strict: options?.strict ?? false,
  });
}
