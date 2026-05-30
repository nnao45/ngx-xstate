import type { AnyActorLogic } from 'xstate';
import type { z } from 'zod';
import type { SchematizedActor } from './types';

export const SCHEMAS_KEY: unique symbol = Symbol('ngxXstateSchemas');

export interface SchemasPayload {
  readonly context: z.ZodTypeAny | undefined;
  readonly events: z.ZodTypeAny | undefined;
  readonly input: z.ZodTypeAny | undefined;
  readonly strict: boolean;
}

export interface SchemaDefinition<
  TCtx extends z.ZodTypeAny,
  TEvents extends z.ZodTypeAny,
  TInput extends z.ZodTypeAny,
> {
  readonly context?: TCtx;
  readonly events?: TEvents;
  readonly input?: TInput;
  readonly strict?: boolean;
}

export function defineActorWithSchema<
  TLogic extends AnyActorLogic,
  TCtx extends z.ZodTypeAny,
  TEvents extends z.ZodTypeAny,
  TInput extends z.ZodTypeAny = z.ZodUndefined,
>(
  logic: TLogic,
  schemas: SchemaDefinition<TCtx, TEvents, TInput>,
): SchematizedActor<TLogic, TCtx, TEvents, TInput> {
  const payload: SchemasPayload = {
    context: schemas.context,
    events: schemas.events,
    input: schemas.input,
    strict: schemas.strict ?? false,
  };

  return Object.assign(
    Object.create(Object.getPrototypeOf(logic) as object) as TLogic,
    logic,
    { [SCHEMAS_KEY]: payload },
  ) as SchematizedActor<TLogic, TCtx, TEvents, TInput>;
}

export function getSchemas(logic: AnyActorLogic): SchemasPayload | undefined {
  const candidate = logic as unknown as Record<typeof SCHEMAS_KEY, SchemasPayload | undefined>;
  return candidate[SCHEMAS_KEY];
}
