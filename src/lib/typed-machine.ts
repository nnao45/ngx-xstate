import {
  setup,
  type ActionFunction,
  type EventObject,
  type GuardPredicate,
  type MachineContext,
  type ParameterizedObject,
  type UnknownActorLogic,
  type Values,
} from 'xstate';
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

// ─── XState setup の内部ヘルパー型を verbatim 再現 ───────────────────────────────
// （actions / guards の ActionFunction / GuardPredicate が要求する TActor / TAction /
//  TGuard スロットの型を setup と「型同一」にするため。ズレると _out_TActor 等の
//  ファントム型で代入不能になる。）

type IsNever<T> = [T] extends [never] ? true : false;
type Invert<T extends Record<PropertyKey, PropertyKey>> = { [K in keyof T as T[K]]: K };

type ToParameterizedObject<TMap extends Record<string, ParameterizedObject['params'] | undefined>> =
  Values<{ [K in keyof TMap as K & string]: { type: K & string; params: TMap[K] } }>;

type ToProvidedActor<
  TChildrenMap extends Record<string, string>,
  TActors extends Record<string, UnknownActorLogic>,
> = Values<{
  [K in keyof TActors as K & string]: {
    src: K & string;
    logic: TActors[K];
    id: IsNever<TChildrenMap> extends true
      ? string | undefined
      : K extends keyof Invert<TChildrenMap>
        ? Invert<TChildrenMap>[K] & string
        : string | undefined;
  };
}>;

// context スキーマ未指定（z.infer = unknown）なら MachineContext にフォールバック
type ResolvedContext<T extends z.ZodTypeAny> =
  z.infer<T> extends MachineContext ? z.infer<T> : MachineContext;

type ParamsMap = Record<string, ParameterizedObject['params'] | undefined>;

// ─── typedSetup（二段階API） ──────────────────────────────────────────

export type TypedMachineDef<
  TEvents extends EventsMap,
  TContextSchema extends z.ZodTypeAny,
  TInputSchema extends z.ZodTypeAny,
  TOutputSchema extends z.ZodTypeAny,
  TActors extends Record<string, UnknownActorLogic>,
  TActions extends ParamsMap,
  TGuards extends ParamsMap,
> = {
  /** イベント名 → ペイロード Zod スキーマ（payload なしは `noPayload`） */
  readonly events: TEvents;
  /** context の Zod スキーマ。指定すると machine 内で context が型付けされる */
  readonly context?: TContextSchema;
  /** input の Zod スキーマ */
  readonly input?: TInputSchema;
  /** output の Zod スキーマ。final state の output を invoke 側で型付けする */
  readonly output?: TOutputSchema;
  /** invoke / spawn で使う actor logic。invoke.src に名前で参照する */
  readonly actors?: TActors;
  /**
   * 名前付き action。XState v5 の params 型を保持したまま透過する。
   * config 側で `{ type: 'name', params: ... }` または `'name'` で参照できる。
   */
  readonly actions?: {
    [K in keyof TActions]: ActionFunction<
      ResolvedContext<TContextSchema>,
      EventUnionFromMap<TEvents>,
      EventUnionFromMap<TEvents>,
      TActions[K],
      ToProvidedActor<Record<never, never>, TActors>,
      ToParameterizedObject<TActions>,
      ToParameterizedObject<TGuards>,
      never,
      EventObject
    >;
  };
  /** 名前付き guard。params 型を保持したまま透過する。 */
  readonly guards?: {
    [K in keyof TGuards]: GuardPredicate<
      ResolvedContext<TContextSchema>,
      EventUnionFromMap<TEvents>,
      TGuards[K],
      ToParameterizedObject<TGuards>
    >;
  };
  /** true でバリデーション失敗時に throw（デフォルト false = warn + no-op） */
  readonly strict?: boolean;
};

/**
 * 型を先に宣言し、後から machine config を検証する二段階 API。
 *
 * XState の `setup({ types, actors, actions, guards }).createMachine(config)` を
 * Zod 連携でラップする。events / context を先に宣言することで、config 内の
 * `assign` の `event` が遷移キーごとに自動 narrow され、`context` も型付けされる。
 * `actions` / `guards` は XState v5 の params 型を壊さず透過する。
 *
 * @example
 * const counter = typedSetup({
 *   context: z.object({ count: z.number() }),
 *   events: { INC: z.object({ by: z.number() }), RESET: noPayload },
 *   actions: {
 *     bump: assign({ count: ({ context }, params: { amount: number }) => context.count + params.amount }),
 *   },
 *   guards: {
 *     underMax: ({ context }, params: { max: number }) => context.count < params.max,
 *   },
 * }).createMachine({
 *   context: { count: 0 },
 *   on: {
 *     INC: {
 *       guard: { type: 'underMax', params: { max: 10 } },
 *       actions: { type: 'bump', params: { amount: 1 } },
 *     },
 *     RESET: { actions: assign({ count: 0 }) },
 *   },
 * });
 */
export function typedSetup<
  TEvents extends EventsMap,
  TContextSchema extends z.ZodTypeAny = z.ZodUnknown,
  TInputSchema extends z.ZodTypeAny = z.ZodUndefined,
  TOutputSchema extends z.ZodTypeAny = z.ZodUnknown,
  TActors extends Record<string, UnknownActorLogic> = Record<never, never>,
  TActions extends ParamsMap = Record<never, never>,
  TGuards extends ParamsMap = Record<never, never>,
>(
  def: TypedMachineDef<
    TEvents,
    TContextSchema,
    TInputSchema,
    TOutputSchema,
    TActors,
    TActions,
    TGuards
  >,
) {
  const outputSchema = def.output ?? z.unknown();

  const base = setup({
    types: {} as {
      context: ResolvedContext<TContextSchema>;
      events: EventUnionFromMap<TEvents>;
      input: z.infer<TInputSchema>;
      output: z.infer<TOutputSchema>;
    },
    // setup の actors パラメータ型に合わせた境界キャスト
    actors: def.actors as { [K in keyof TActors]: K extends keyof TActors ? TActors[K] : never },
  });

  const s = base.extend({
    actions: def.actions,
    guards: def.guards,
  });

  const payload: SchemasPayload = {
    context: def.context,
    events: buildEventSchema(def.events),
    input: def.input,
    output: outputSchema,
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
