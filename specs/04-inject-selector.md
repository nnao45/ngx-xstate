# `injectSelector()`

## Purpose

Actor の snapshot から特定の値を選択し、Signal として返す。デフォルトで shallow equal による比較を行うため、選択した値が実際に変わったときだけ Signal が更新される。`@xstate/react` の `useSelector()` 相当。

---

## Signature

```typescript
function injectSelector<
  TActor extends Pick<AnyActorRef, 'subscribe' | 'getSnapshot'>,
  T
>(
  actor: TActor,
  selector: (snapshot: SnapshotFrom<TActor>) => T,
): Signal<T>
```

`@xstate/react` と異なり `compare` 引数は**ない**。Signal の `equal` オプションで shallow equal をデフォルト適用するため、ユーザーが比較関数を渡す必要がない。

---

## Behavior

### デフォルト shallow equal

```typescript
const context = injectSelector(actorRef, s => s.context);
// context オブジェクトの中身が同じなら Signal は更新されない
// → OnPush コンポーネントの不要な再描画を防ぐ
```

内部実装:

```typescript
const selected = signal(selector(actor.getSnapshot()), {
  equal: shallowEqual  // デフォルト
});
```

### 購読と更新

```
actor.subscribe(snapshot => {
  const next = selector(snapshot);
  // shallowEqual で比較
  // 異なる場合のみ signal.set(next)
})
```

### injection context 内での自動クリーンアップ

injection context 内で呼ばれた場合、`DestroyRef` で購読を自動解除する。

injection context 外（例: `createActorContext` の `injectSelector` ラッパー内）では呼び出し元が `DestroyRef` を管理する。

---

## Usage

### 基本

```typescript
@Component({})
export class CounterComponent {
  private actor = injectActorRef(counter);

  count = injectSelector(this.actor, s => s.context.count);
  // count: Signal<number>
}
```

### テンプレートで使う

```html
<p>Count: {{ count() }}</p>
<p *ngIf="isActive()">Active</p>
```

### オブジェクト選択（shallow equal が効く）

```typescript
// context 全体を選択しても、プロパティが変わらなければ更新されない
const ctx = injectSelector(actor, s => s.context);

// 新しいオブジェクト参照でも中身が同じなら更新なし:
// { count: 0 } === { count: 0 } → shallow equal → Signal 更新なし
```

### 複数 selector

```typescript
@Component({ changeDetection: ChangeDetectionStrategy.OnPush })
export class FormComponent {
  private actor = injectActorRef(formMachine);

  isSubmitting = injectSelector(this.actor, s => s.matches('submitting'));
  errors       = injectSelector(this.actor, s => s.context.errors);
  values       = injectSelector(this.actor, s => s.context.values);
}
```

---

## `shallowEqual` の定義

```typescript
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null) return false;
  if (typeof b !== 'object' || b === null) return false;

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);

  if (keysA.length !== keysB.length) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  return keysA.every(key => Object.is(objA[key], objB[key]));
}
```

プリミティブ値（`number`、`string`、`boolean`）には `Object.is` が効くので、数値や文字列の選択でも余分な再計算は起きない。

---

## Differences from `@xstate/react`'s `useSelector`

| | `useSelector` (React) | `injectSelector` (Angular) |
|---|---|---|
| compare 引数 | あり（オプション） | **なし**（shallow equal が常にデフォルト） |
| 再描画トリガー | `compare` が false を返したとき | Signal の `equal` が false を返したとき |
| undefined actor | 対応（optional chaining） | 対応 |

---

## Constraints

- injection context 内、または `runInInjectionContext` 内でのみ使える
- 返り値は readonly Signal。直接 `.set()` はできない
