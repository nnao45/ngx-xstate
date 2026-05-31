import type { AnyActorLogic } from 'xstate';
import type { z } from 'zod';

export const SCHEMAS_KEY: unique symbol = Symbol('ngxXstateSchemas');

export type SchemasPayload = {
  readonly context: z.ZodTypeAny | undefined;
  readonly events: z.ZodTypeAny | undefined;
  readonly input: z.ZodTypeAny | undefined;
  readonly output: z.ZodTypeAny;
  readonly strict: boolean;
};

/**
 * actor logic に Zod スキーマ情報をランタイムで付与する（インプレース）。
 * 型は変えず、SCHEMAS_KEY のプロパティだけ足す。getSchemas で取り出す。
 */
export function attachSchemas<TLogic extends AnyActorLogic>(
  logic: TLogic,
  payload: SchemasPayload,
): TLogic {
  (logic as unknown as Record<typeof SCHEMAS_KEY, SchemasPayload>)[SCHEMAS_KEY] = payload;
  return logic;
}

export function getSchemas(logic: AnyActorLogic): SchemasPayload | undefined {
  const candidate = logic as unknown as Record<typeof SCHEMAS_KEY, SchemasPayload | undefined>;
  return candidate[SCHEMAS_KEY];
}
