# `injectActor()`

## Purpose

XState actor を Angular injection context で起動し、state を Signal として返す。`@xstate/react` の `useActor()` 相当。コンポーネント/サービスの破棄時に actor を自動停止する。

---

## Signature

```typescript
function injectActor<TLogic extends AnyActorLogic>(
  logic: TLogic | SchematizedActor<TLogic, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  options?: InjectActorOptions<TLogic>
): InjectActorReturn<TLogic>
```

### `InjectActorOptions`

```typescript
type InjectActorOptions<TLogic extends AnyActorLogic> = {
  input?: InputFrom<TLogic> | (() => InputFrom<TLogic>);
  inspect?: (event: InspectionEvent) => void;
  id?: string;
  systemId?: string;
  snapshot?: SnapshotFrom<TLogic>;  // rehydration用
};
```

### `InjectActorReturn`

```typescript
type InjectActorReturn<TLogic extends AnyActorLogic> = {
  snapshot: Signal<SnapshotFrom<TLogic>>;
  send: SendFn<TLogic>;  // Zodスキーマがあれば z.infer<TEventSchema>、なければ EventFrom<TLogic>
  actorRef: Actor<TLogic>;
};
```

---

## Behavior

### 1. injection context 必須

`inject()` を内部で呼ぶため、Angular の injection context（コンポーネントコンストラクタ、`runInInjectionContext`）内でのみ呼べる。injection context 外で呼ぶと Angular の標準エラーが出る。

### 2. 自動ライフサイクル管理

```
injectActor() 呼び出し
  → inject(DestroyRef)  ← 自動でスコープ取得
  → createActor(logic, resolvedOptions)
  → actor.subscribe(snapshot => snapshotSignal.set(snapshot))
  → actor.start()
  → DestroyRef.onDestroy(() => { subscription.unsubscribe(); actor.stop(); })
```

### 3. Signal の初期値

actor 起動前の初期 snapshot を `actor.getSnapshot()` で取得して Signal の初期値にする。

### 4. dynamic input

`input` に関数を渡すと、`effect()` でリアクティブに追跡し、input が変わったら actor を再起動する。

```typescript
@Component({})
class UserComponent {
  userId = input.required<string>();

  actor = injectActor(userMachine, {
    input: () => ({ userId: this.userId() })
    //     ^^^^ 関数形式 → userId Signal を追跡
  });
}
```

**注意**: actor の再起動時は前の actor を stop() してから新しい actor を start() する。state はリセットされる（rehydration が必要なら `snapshot` オプションを使う）。

### 5. Zod event validation

`SchematizedActor` が渡された場合、返り値の `send` 関数はイベントを Zod でバリデーションしてから actor に転送する。

```typescript
// strict=false (デフォルト)
send({ type: 'UNKNOWN' })
// → console.warn('[ngx-xstate] Invalid event: ...')
// → actor には転送しない

// strict=true
send({ type: 'UNKNOWN' })
// → throws ZodError
```

---

## Usage

### 基本

```typescript
import { Component } from '@angular/core';
import { injectActor } from 'ngx-xstate';
import { counter } from './counter.machine';

@Component({
  selector: 'app-counter',
  template: `
    <p>Count: {{ actor.snapshot().context.count }}</p>
    <button (click)="actor.send({ type: 'INCREMENT' })">+</button>
    <button (click)="actor.send({ type: 'DECREMENT' })">-</button>
  `,
})
export class CounterComponent {
  actor = injectActor(counter);
}
```

### destructuring

```typescript
export class CounterComponent {
  readonly { snapshot, send } = injectActor(counter);
}
```

### dynamic input

```typescript
@Component({})
export class UserDetailComponent {
  userId = input.required<string>();

  readonly { snapshot } = injectActor(userMachine, {
    input: () => ({ userId: this.userId() }),
  });
}
```

### devtools

```typescript
readonly { snapshot } = injectActor(counter, {
  inspect: (event) => {
    if (event.type === '@xstate.snapshot') {
      console.log(event.snapshot);
    }
  },
});
```

### rehydration

```typescript
const persistedSnapshot = JSON.parse(localStorage.getItem('counter') ?? 'null');

readonly { snapshot, send } = injectActor(counter, {
  snapshot: persistedSnapshot ?? undefined,
});
```

---

## Type Examples

```typescript
// Zod スキーマあり → 型が z.infer から来る
const { send } = injectActor(counter);
send({ type: 'INCREMENT' });       // ✅
send({ type: 'RESET' });           // ❌ TypeScript compile error

// Zod スキーマなし → EventFrom<TLogic> を使う
const { send } = injectActor(rawMachine);
send({ type: 'WHATEVER' });        // ✅ (XState の型のみ)
```

---

## Constraints

- injection context 内でのみ呼べる
- dynamic input で actor が再起動するとき、前の actor の未完了 Promise/Observable は中断される
- `actorRef` は `snapshot` Signal と同じ actor への参照。直接 `actorRef.send()` も可能だが Zod バリデーションはバイパスされる
