import { createMachine, type AnyActorLogic } from 'xstate';
import { z, type ZodDiscriminatedUnionOption } from 'zod';
import { defineActorWithSchema, SCHEMAS_KEY } from './define-actor-with-schema';
import type { SchematizedActor } from './types';
import type {
  AnyStateConfig,
  AllEventKeys,
  PayloadSchemas,
  TypedEventUnion,
} from './typed-machine-types';

// ─── Runtime: collect all `on` keys recursively ──────────────────────────────

function collectOnKeys(config: AnyStateConfig, keys: Set<string> = new Set()): Set<string> {
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

  if (schemas.length === 0) {
    return z.object({ type: z.string() });
  }

  if (schemas.length === 1) {
    return schemas[0] as TypedEventSchema;
  }

  const duSchemas = schemas as unknown as [
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

export function createTypedMachine<
  TConfig extends AnyStateConfig,
  TPayloads extends Partial<Record<AllEventKeys<TConfig> & string, z.ZodObject<z.ZodRawShape>>> = Record<never, never>,
  TContextSchema extends z.ZodTypeAny = z.ZodUnknown,
  TInputSchema extends z.ZodTypeAny = z.ZodUndefined,
>(
  config: TConfig,
  options?: CreateTypedMachineOptions<TPayloads, TContextSchema, TInputSchema>,
): SchematizedActor<
  AnyActorLogic,
  TContextSchema,
  z.ZodType<TypedEventUnion<AllEventKeys<TConfig> & string, TPayloads>>,
  TInputSchema
> {
  const machine = createMachine(config as Parameters<typeof createMachine>[0]);

  const onKeys = collectOnKeys(config);
  const payloads = (options?.payloads ?? {}) as Partial<Record<string, z.ZodObject<z.ZodRawShape>>>;
  const eventSchema = buildEventSchema(onKeys, payloads) as z.ZodType<
    TypedEventUnion<AllEventKeys<TConfig> & string, TPayloads>
  >;

  return defineActorWithSchema(machine as AnyActorLogic, {
    events: eventSchema,
    context: options?.context,
    input: options?.input,
    strict: options?.strict ?? false,
  }) as SchematizedActor<
    AnyActorLogic,
    TContextSchema,
    z.ZodType<TypedEventUnion<AllEventKeys<TConfig> & string, TPayloads>>,
    TInputSchema
  >;
}
