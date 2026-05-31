# `typedSetup()`

## Purpose

型を先に宣言してから machine config を検証する**二段階 API**。XState の
`setup({ types }).createMachine(config)` を Zod 連携でラップする。

これにより:
- `send()` が定義済みイベントのみに型付けされる（不正な type はコンパイルエラー）
- machine 定義内の `assign` の `event` が**遷移キーごとに自動 narrow** される（注釈不要）
- `context` も Zod スキーマから型付けされる
- イベントペイロードがランタイムで Zod バリデーションされる

---

## なぜ二段階か

TypeScript の評価順序の制約により、「単一呼び出しで `on` キーからイベント型を推論」
かつ「その型で config 内の action を型検査」を両立できない。config リテラルは
自身の `on` キーが読まれる前にジェネリック制約（`events = AnyEventObject`）で
検証されるため。XState 本体が `setup().createMachine()` の二段階を採用したのと
同じ理由。型を**先に**宣言する phase 1 が必須。

---

## Signature

```typescript
function typedSetup<
  TEvents extends EventsMap,
  TContextSchema extends z.ZodTypeAny = z.ZodUnknown,
  TInputSchema extends z.ZodTypeAny = z.ZodUndefined,
  TActors extends Record<string, UnknownActorLogic> = Record<never, never>,
  TActions extends ParamsMap = Record<never, never>,
  TGuards extends ParamsMap = Record<never, never>,
>(def: TypedMachineDef<...>): { createMachine: SetupInstance['createMachine'] };

type EventsMap = Record<string, z.ZodObject<z.ZodRawShape>>;

type TypedMachineDef<...> = {
  events: TEvents;            // イベント名 → ペイロード Zod（payload なしは noPayload）
  context?: TContextSchema;   // context の Zod スキーマ
  input?: TInputSchema;       // input の Zod スキーマ
  actors?: TActors;           // invoke/spawn 用 actor logic（src で名前参照）
  actions?: {...};            // 名前付き action（XState v5 の params 型を保持）
  guards?: {...};             // 名前付き guard（params 型を保持）
  strict?: boolean;           // true で throw（デフォルト false = warn + no-op）
};
```

戻り値は `{ createMachine }`。setup インスタンスの `createMachine` そのもの（型推論を保持）。

### actions / guards（params 型の透過）

XState v5 の `setup({ actions, guards })` と同様、名前付き action / guard を宣言できる。
**第2引数 `params` の型を壊さず透過**するため、`setup` 内部の `ToProvidedActor` /
`ToParameterizedObject` ヘルパーを verbatim 再現し、`ActionFunction` / `GuardPredicate`
のスロット型を `setup` と型同一にしている（ズレると `_out_TActor` ファントム型で代入不能）。

```typescript
typedSetup({
  context: z.object({ count: z.number() }),
  events: { STEP: z.object({ by: z.number() }) },
  actions: {
    bump: assign({ count: ({ context }, p: { amount: number }) => context.count + p.amount }),
  },
  guards: { underMax: ({ context }, p: { max: number }) => context.count < p.max },
}).createMachine({
  context: { count: 0 },
  on: {
    STEP: {
      guard: { type: 'underMax', params: { max: 10 } }, // params 型付き
      actions: { type: 'bump', params: { amount: 1 } }, // params 型付き
    },
  },
});
```

### 既知の型の限界

子「ステートマシン」を `invoke` して `onDone.event.output` を読むケースは、
`actions`/`guards` 対応で `actors` を `setup` の正確なパラメータ型へキャストする都合上、
`event.output` が `any` に落ちることがある（XState v5 の型の交差領域の限界。`fromPromise`
の actor では型付く）。回避策: actor を `fromPromise` にするか、`event.output` をキャスト
して取り出す。

---

## EventsMap

全ての値が `z.ZodObject`。ペイロードなしは `noPayload`（= `z.object({})`）で表す。
`null` は使わない（`z.null()` は「値が null」を意味し別物のため、Zod で統一）。

| 値 | 意味 | 生成されるイベント型 |
|---|---|---|
| `z.object({...})` | ペイロードあり | `{ type: K } & z.infer<schema>` |
| `noPayload` (= `z.object({})`) | ペイロードなし | `{ type: K }` |
| （空マップ `{}`） | イベント未定義 | `{ type: string }`（緩いイベント型） |

---

## Usage

### 基本

```typescript
import { z } from 'zod';
import { assign } from 'xstate';
import { typedSetup, noPayload } from 'ngx-xstate';

const todo = typedSetup({
  context: z.object({ items: z.array(z.string()) }),
  events: {
    ADD: z.object({ item: z.string() }),   // payload あり
    REMOVE: z.object({ index: z.number() }),
    CLEAR: noPayload,                       // payload なし (= z.object({}))
  },
  strict: false,
}).createMachine({
  context: { items: [] },
  on: {
    // event は ADD 遷移内で { type:'ADD'; item:string } に自動 narrow。注釈不要
    ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
    REMOVE: {
      actions: assign({ items: ({ context, event }) => context.items.filter((_, i) => i !== event.index) }),
    },
    CLEAR: { actions: assign({ items: [] }) },
  },
});

// send は型付き
const { send } = injectActor(todo);
send({ type: 'ADD', item: 'x' });  // ✅
send({ type: 'TYPO' });            // ❌ コンパイルエラー
```

### invoke（actors）

`invoke.src` に inline logic を渡せない（setup の制約）。`actors` に登録して
名前参照する。`onDone` の `event.output` が actor の出力型に型付けされる。

```typescript
const fetch = typedSetup({
  context: z.object({ user: userSchema.nullable() }),
  events: { FETCH: null },
  actors: { fetchUser: fromPromise(({ input }) => api.getUser(input.id)) },
}).createMachine({
  context: { user: null },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: {
      invoke: {
        src: 'fetchUser',
        input: { id: 1 },
        onDone: { actions: assign({ user: ({ event }) => event.output }) }, // output 型付き
      },
    },
  },
});
```

### context スキーマ未指定

`context` を省略すると machine 内の context 型は `unknown`。typed な context が
欲しいときは必ず Zod スキーマを渡す。

---

## Validation Behavior

`injectActor().send()` 経由でイベントが Zod バリデーションされる:

- `strict: false`（デフォルト）: 失敗時は `console.warn` + no-op（XState の未知イベント挙動と一貫）
- `strict: true`: 失敗時に `ZodError` を throw

```typescript
send({ type: 'ADD', item: 123 });  // strict=false → warn + 無視 / strict=true → throw
```

ランタイムスキーマは `events` マップから `z.discriminatedUnion` を自動構築する。
machine には `attachSchemas()` でスキーマ情報がランタイム付与され、`getSchemas()`
で `injectActor` の `send` が参照する。

---

## Implementation Notes

- `create = setupInstance.createMachine`（同一シグネチャ）。生成 machine に
  `attachSchemas()` でスキーマをインプレース付与してから返す。型は machine そのまま。
- `send` の型は machine 自身のイベント型（setup で型付け済み）から来るため、
  別途ブランド型は不要。
- 戻り値型は推論に任せる（明示注釈すると XState の MachineSnapshot ジェネリックを
  再現できず `any` 化するため）。
