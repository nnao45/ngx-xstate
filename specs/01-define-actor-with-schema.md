# `defineActorWithSchema()`

## Purpose

Zod スキーマを XState machine に紐付ける。スキーマは一度ここで定義すれば `injectActor`、`injectSelector`、`createActorContext` 全体に型が自動で流れる。

---

## Signature

```typescript
function defineActorWithSchema<
  TLogic extends AnyActorLogic,
  TContextSchema extends z.ZodTypeAny,
  TEventSchema extends z.ZodTypeAny,
  TInputSchema extends z.ZodTypeAny = z.ZodUndefined,
>(
  logic: TLogic,
  schemas: {
    context?: TContextSchema;
    events?: TEventSchema;
    input?: TInputSchema;
    strict?: boolean;  // default: false
  }
): SchematizedActor<TLogic, TContextSchema, TEventSchema, TInputSchema>
```

---

## Return Type: `SchematizedActor`

`defineActorWithSchema` が返すのは元の `logic` を **ラップした不透明なオブジェクト**。XState の `AnyActorLogic` インターフェースを満たしつつ、スキーマ情報を型レベルで付加する。

```typescript
declare const SCHEMAS_BRAND: unique symbol;

type SchematizedActor<
  TLogic extends AnyActorLogic,
  TCtx extends z.ZodTypeAny,
  TEvents extends z.ZodTypeAny,
  TInput extends z.ZodTypeAny,
> = TLogic & {
  readonly [SCHEMAS_BRAND]: {
    readonly context: TCtx;
    readonly events: TEvents;
    readonly input: TInput;
    readonly strict: boolean;
  };
};
```

実行時にはロジック自体は変わらず、スキーマ情報だけ付加される。

---

## Parameters

### `logic`
任意の XState actor logic。`createMachine()`、`fromPromise()`、`fromObservable()` など。

### `schemas.context`
`z.ZodTypeAny`。`snapshot.context` の型として使われる。バリデーションは actor 起動時の初期 context と `input` → context 変換後に実行される。

### `schemas.events`
`z.ZodDiscriminatedUnion` または `z.ZodUnion`。`send()` に渡すイベントのランタイムバリデーションに使われる。

```typescript
events: z.discriminatedUnion('type', [
  z.object({ type: z.literal('INCREMENT') }),
  z.object({ type: z.literal('DECREMENT'), by: z.number() }),
])
```

### `schemas.input`
`z.ZodTypeAny`。`injectActor(machine, { input: ... })` で渡す値のバリデーションに使われる。

### `schemas.strict`
`boolean`、デフォルト `false`。

- `false`: バリデーション失敗時は `console.warn` して no-op（XState 本体の未知イベント挙動と同じ）
- `true`: バリデーション失敗時に `ZodError` を throw

---

## Usage

```typescript
import { z } from 'zod';
import { createMachine } from 'xstate';
import { defineActorWithSchema } from 'ngx-xstate';

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

export const counter = defineActorWithSchema(counterMachine, {
  context: z.object({ count: z.number() }),
  events: z.discriminatedUnion('type', [
    z.object({ type: z.literal('INCREMENT') }),
    z.object({ type: z.literal('DECREMENT') }),
  ]),
  strict: false,
});
```

---

## Type Flow

```
defineActorWithSchema(machine, { events: eventSchema, context: contextSchema })
    │
    ▼
SchematizedActor<TMachine, TContextSchema, TEventSchema>
    │
    ├── injectActor(machine)
    │       send: (event: z.infer<TEventSchema>) => void   ← Zod型で補完が効く
    │       snapshot: Signal<{ context: z.infer<TContextSchema>, ... }>
    │
    └── createActorContext(machine)
            injectSelector(s => s.context.count)  ← count は number と推論される
```

---

## Validation Behavior

### Event validation (`send`)

```typescript
const { send } = injectActor(counter);

send({ type: 'INCREMENT' });      // OK
send({ type: 'DECREMENT' });      // OK
send({ type: 'RESET' });          // strict=false → console.warn, no-op
                                  // strict=true  → throws ZodError
```

### Context validation (actor start)

actor 起動時、XState が計算した初期 context を `schemas.context` で検証する。開発時の machine 定義ミスを早期発見できる。

### Input validation

```typescript
const { snapshot } = injectActor(userMachine, {
  input: { userId: 123 }  // userId が z.string() なら warn/throw
});
```

---

## Implementation Notes

- `logic` への参照は変えずにスキーマ情報を symbol key で付加する
- XState の `AnyActorLogic` インターフェースを壊さない（そのまま `createActor()` に渡せる）
- `strict` フラグはスキーマオブジェクトに保存し、`injectActor` 内部で参照する
