# `injectActorRef()`

## Purpose

Actor の参照だけを返す。snapshot Signal は返さない。`injectSelector()` と組み合わせて使うか、actor の送信・購読を自分で管理したいときに使う。`@xstate/react` の `useActorRef()` 相当。

---

## Signature

```typescript
function injectActorRef<TLogic extends AnyActorLogic>(
  logic: TLogic | SchematizedActor<TLogic, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  options?: InjectActorOptions<TLogic>
): Actor<TLogic>
```

`InjectActorOptions` は `injectActor()` と同一。

---

## Behavior

- `injectActor()` と同じライフサイクル管理（`DestroyRef` で自動 start/stop）
- snapshot Signal を作らない分、`injectActor()` より軽量
- 返り値の `Actor<TLogic>` は `subscribe()` や `getSnapshot()` を持つ標準 XState actor

---

## Usage

### `injectSelector()` と組み合わせる

```typescript
@Component({})
export class CounterComponent {
  private actorRef = injectActorRef(counter);

  count = injectSelector(this.actorRef, s => s.context.count);
  isActive = injectSelector(this.actorRef, s => s.matches('active'));

  increment() {
    this.actorRef.send({ type: 'INCREMENT' });
  }
}
```

### 複数の selector を効率よく使いたい場合

`injectActor()` だと `snapshot()` 全体が Signal になるが、`injectActorRef()` + `injectSelector()` の組み合わせでは各 selector が個別にメモ化される。必要な値だけを精密に購読できる。

```typescript
@Component({ changeDetection: ChangeDetectionStrategy.OnPush })
export class DashboardComponent {
  private actor = injectActorRef(dashboardMachine);

  // count が変わっても isLoading の再計算は走らない
  count    = injectSelector(this.actor, s => s.context.count);
  isLoading = injectSelector(this.actor, s => s.matches('loading'));
  error     = injectSelector(this.actor, s => s.context.error);
}
```

---

## Differences from `injectActor()`

| | `injectActor()` | `injectActorRef()` |
|---|---|---|
| 戻り値 | `{ snapshot, send, actorRef }` | `Actor<TLogic>` |
| snapshot Signal | あり（全体） | なし |
| Zod event validation on `send` | あり | なし（直接 actor.send） |
| 用途 | シンプルなケース | 細かい selector 管理 |

---

## Constraints

- injection context 内でのみ呼べる
- Zod event validation が不要な場合、`actorRef.send()` を直接呼べばバリデーションをバイパスできる（意図的な設計）
