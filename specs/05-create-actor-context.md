# `createActorContext()`

## Purpose

コンポーネントツリー内で actor を共有する。React の `createContext()` + `<Provider>` 相当を Angular DI で実現する。`InjectionToken` と `provideActor()` を使ってコンポーネントスコープの DI を提供する。

---

## Signature

```typescript
function createActorContext<
  TLogic extends AnyActorLogic,
>(
  logic: TLogic | SchematizedActor<TLogic, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  defaultOptions?: InjectActorOptions<TLogic>
): ActorContext<TLogic>
```

### `ActorContext`

```typescript
type ActorContext<TLogic extends AnyActorLogic> = {
  provideActor(options?: InjectActorOptions<TLogic>): Provider;
  injectActorRef(): Actor<TLogic>;
  injectSelector<T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
  ): Signal<T>;
};
```

---

## Behavior

### `provideActor(options?)`

Angular コンポーネントの `providers` 配列に渡す `Provider` を返す。このコンポーネントとその子孫に actor インスタンスをスコープする。

```typescript
@Component({
  providers: [CounterContext.provideActor()]
})
class ParentComponent {}
```

複数インスタンスが必要なら、それぞれのコンポーネントで別々に `provideActor()` を呼ぶ。

```typescript
@Component({ providers: [CounterContext.provideActor()] })
class CounterA {}

@Component({ providers: [CounterContext.provideActor()] })
class CounterB {}
// CounterA と CounterB は独立した actor インスタンスを持つ
```

### `injectActorRef()`

injection context 内で、`provideActor()` で提供された actor への参照を取得する。injection context ツリー上に `provideActor()` がなければエラーをスローする。

```typescript
@Component({})
class ChildComponent {
  private actor = CounterContext.injectActorRef();
  //              ^ inject() で InjectionToken を解決する
}
```

### `injectSelector(selector)`

`injectActorRef()` + `injectSelector()` のショートカット。

```typescript
@Component({})
class ChildComponent {
  count = CounterContext.injectSelector(s => s.context.count);
  // Signal<number>
}
```

---

## Internal Structure

```typescript
function createActorContext(logic, defaultOptions) {
  const TOKEN = new InjectionToken<Actor<TLogic>>('NgxXstateActor');

  return {
    provideActor(options) {
      return {
        provide: TOKEN,
        useFactory: () => {
          // injection context 内で呼ばれる
          const mergedOptions = { ...defaultOptions, ...options };
          return injectActorRef(logic, mergedOptions);
          // DestroyRef はこのコンポーネントのスコープで解決される
        }
      };
    },

    injectActorRef() {
      const actor = inject(TOKEN, { optional: true });
      if (!actor) {
        throw new Error(
          '[ngx-xstate] injectActorRef() was called outside of a component ' +
          'that provides this actor. Make sure to add provideActor() to the ' +
          'component\'s providers array.'
        );
      }
      return actor;
    },

    injectSelector(selector) {
      const actor = this.injectActorRef();
      return injectSelector(actor, selector);
    }
  };
}
```

---

## Usage

### 基本的なツリー共有

```typescript
// counter.machine.ts
export const CounterContext = createActorContext(counter);

// parent.component.ts
@Component({
  selector: 'app-parent',
  template: `<app-child-a /><app-child-b />`,
  providers: [CounterContext.provideActor()],
})
export class ParentComponent {}

// child-a.component.ts
@Component({ selector: 'app-child-a' })
export class ChildAComponent {
  count = CounterContext.injectSelector(s => s.context.count);
}

// child-b.component.ts
@Component({ selector: 'app-child-b' })
export class ChildBComponent {
  private actor = CounterContext.injectActorRef();

  decrement() {
    this.actor.send({ type: 'DECREMENT' });
  }
}
```

### オプションをオーバーライド

```typescript
// デフォルトオプションあり
export const UserContext = createActorContext(userMachine, {
  inspect: (e) => console.log(e),
});

// 特定のコンポーネントで input をオーバーライド
@Component({
  providers: [UserContext.provideActor({ input: { userId: '123' } })],
})
export class UserDetailComponent {}
```

### dynamic input との組み合わせ

```typescript
@Component({
  providers: [
    UserContext.provideActor({
      input: () => inject(ActivatedRoute).snapshot.params['id']
    })
  ]
})
export class UserPageComponent {}
```

---

## Scoping

`provideActor()` は Angular コンポーネントの DI スコープに従う:

```
AppComponent
├── ParentA (providers: [CounterContext.provideActor()])  ← ActorInstance #1
│   ├── ChildA  (CounterContext.injectActorRef() → #1)
│   └── ChildB  (CounterContext.injectActorRef() → #1)
└── ParentB (providers: [CounterContext.provideActor()])  ← ActorInstance #2
    └── ChildC  (CounterContext.injectActorRef() → #2)
```

---

## Error Cases

| ケース | エラー |
|---|---|
| `provideActor()` なしで `injectActorRef()` を呼ぶ | `[ngx-xstate] injectActorRef() was called outside of...` |
| injection context 外で `injectActorRef()` を呼ぶ | Angular 標準の injection context エラー |
