import { setup, type AnyActorLogic } from 'xstate';
import { z, type ZodDiscriminatedUnionOption } from 'zod';
import { attachSchemas, type SchemasPayload } from './schemas';
import type { EventsMap, EventUnionFromMap } from './typed-machine-types';

/**
 * ペイロードを持たないイベントを表す Zod スキーマ（= `z.object({})`）。
 * `events` マップで `KEY: noPayload` と書くと `{ type: 'KEY' }` 型になる。
 */
export const noPayload: z.ZodObject<Record<never, never>> = z.object({});

// ─── Runtime: EventsMap から discriminatedUnion Zod スキーマを構築 ──────────────

type TypedEventSchema = z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>;

function buildEventSchema(events: EventsMap): z.ZodTypeAny {
  const schemas = Object.entries(events).map(([key, payload]): TypedEventSchema => {
    const base = z.object({ type: z.literal(key) });
    return base.merge(payload) as TypedEventSchema;
  });

  // discriminatedUnion は「2要素以上」のタプルを要求するため分岐 + narrow する。
  const [first, second, ...rest] = schemas;

  if (first === undefined) {
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

// ─── typedSetup（二段階API） ──────────────────────────────────────────

export type TypedMachineDef<
  TEvents extends EventsMap,
  TContextSchema extends z.ZodTypeAny,
  TInputSchema extends z.ZodTypeAny,
  TActors extends Record<string, AnyActorLogic>,
> = {
  /** イベント名 → ペイロード Zod スキーマ（payload なしは null） */
  readonly events: TEvents;
  /** context の Zod スキーマ。指定すると machine 内で context が型付けされる */
  readonly context?: TContextSchema;
  /** input の Zod スキーマ */
  readonly input?: TInputSchema;
  /** invoke / spawn で使う actor logic。invoke.src に名前で参照する */
  readonly actors?: TActors;
  /** true でバリデーション失敗時に throw（デフォルト false = warn + no-op） */
  readonly strict?: boolean;
};

/**
 * 型を先に宣言し、後から machine config を検証する二段階 API。
 *
 * XState の `setup({ types }).createMachine(config)` を Zod 連携でラップする。
 * events / context を先に宣言することで、config 内の `assign` の `event` が
 * 遷移キーごとに自動 narrow され、`context` も型付けされる。
 *
 * @example
 * const todo = typedSetup({
 *   context: z.object({ items: z.array(z.string()) }),
 *   events: {
 *     ADD: z.object({ item: z.string() }),
 *     CLEAR: noPayload, // = z.object({})
 *   },
 * }).createMachine({
 *   context: { items: [] },
 *   on: {
 *     ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
 *     CLEAR: { actions: assign({ items: [] }) },
 *   },
 * });
 */
export function typedSetup<
  TEvents extends EventsMap,
  TContextSchema extends z.ZodTypeAny = z.ZodUnknown,
  TInputSchema extends z.ZodTypeAny = z.ZodUndefined,
  TActors extends Record<string, AnyActorLogic> = Record<never, never>,
>(def: TypedMachineDef<TEvents, TContextSchema, TInputSchema, TActors>) {
  const s = setup({
    types: {} as {
      context: z.infer<TContextSchema>;
      events: EventUnionFromMap<TEvents>;
      input: z.infer<TInputSchema>;
    },
    actors: (def.actors ?? {}) as TActors,
  });

  const payload: SchemasPayload = {
    context: def.context,
    events: buildEventSchema(def.events),
    input: def.input,
    strict: def.strict ?? false,
  };

  // createMachine は s.createMachine と同一シグネチャ（完全な型推論を保つ）。
  // 生成した machine にランタイムでスキーマを付与してから返す。
  const createMachine = ((config: Parameters<typeof s.createMachine>[0]) => {
    const machine = s.createMachine(config);
    return attachSchemas(machine, payload);
  }) as unknown as typeof s.createMachine;

  return { createMachine };
}
