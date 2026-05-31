# ngx-xstate — Architecture Overview

## What This Is

Angular bindings for XState v5. The Angular equivalent of `@xstate/react`, built on Angular Signals with Zod schema integration.

## Core Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Reactive primitive | Angular Signals | XState actors are synchronous push-based stores — maps directly to Signals without async pipes |
| 2 | Angular version | 19+ | `linkedSignal`, stable `input()`/`output()`, stable `DestroyRef` |
| 3 | Function naming | `injectXxx` prefix | Matches Angular community convention (`injectQuery`, `injectParams`, etc.) |
| 4 | Return type | Object `{ snapshot, send, actorRef }` | Named destructuring over tuple; Angularでは自然 |
| 5 | Zod placement | `createTypedMachine(def).create(config)` 二段階 | 型を先に宣言→config検証。assign の event 自動 narrow。`defineActorWithSchema` は廃止 |
| 6 | Validation failure | No-op default + `strict: true` | Consistent with XState's own no-op behavior for unknown events |
| 7 | createActorContext | InjectionToken + `provideActor()` | Angular DI as the Provider equivalent |
| 8 | Package structure | ng-packagr standalone | One package, no NX monorepo overhead |
| 9 | useMachine | Not provided | Clean slate — no deprecated aliases |
| 10 | shallowEqual | Built into `injectSelector` default | Signal `equal` option absorbs the comparison; users don't need to pass compare functions |
| 11 | Package name | `ngx-xstate` | Angular community `ngx-` convention |
| 12 | Testing utils | Docs only for now | Implement core first |
| 13 | Actor lifecycle | Auto via `DestroyRef` | Mount = start, destroy = stop, zero boilerplate |
| 14 | `input` support | Static + dynamic (function) | Supports both literal values and Signal-connected functions |
| 15 | Devtools | Pass-through `inspect` option | Users connect Stately Visualizer themselves |

---

## Public API Surface

```
ngx-xstate
├── createTypedMachine(def)                   → { create(config) → Machine }  (二段階API)
├── injectActor(machine, options?)            → { snapshot, send, actorRef }
├── injectActorRef(machine, options?)         → Actor<T>
├── injectSelector(actorRef, selector)        → Signal<T>   (shallow equal by default)
├── createActorContext(machine, options?)     → {
│       provideActor(options?),
│       injectActorRef(),
│       injectSelector(selector)
│   }
└── provideXstateDevtools(inspector)          → EnvironmentProviders  (dev のみ)
```

---

## Dependency Graph

```
@xstate/angular
  ├── peerDep: xstate ^5.x
  ├── peerDep: @angular/core ^19.x
  └── peerDep: zod ^3.x
```

---

## Reactive Data Flow

```
XState Actor
    │  actor.subscribe(snapshot => ...)
    ▼
signal<SnapshotFrom<T>>()   ← updated on every state transition
    │  snapshot()
    ▼
Angular Template (OnPush-compatible)
```

No `async` pipe. No `zone.js` dependency. Works with both default and zoneless change detection.

---

## Actor Lifecycle (automatic)

```
injectActor() called
    │  inject(DestroyRef)
    │  createActor(logic, options)  → actor (not started yet)
    │  actor.subscribe(s => snapshot.set(s))
    │  actor.start()
    │
    ▼  (component destroyed)
    │  actor.stop()
    │  subscription.unsubscribe()
```

---

## File Structure (post-implementation)

```
ngx-xstate/
├── specs/                        ← this directory
├── src/
│   ├── lib/
│   │   ├── define-actor-with-schema.ts
│   │   ├── inject-actor.ts
│   │   ├── inject-actor-ref.ts
│   │   ├── inject-selector.ts
│   │   └── create-actor-context.ts
│   └── public-api.ts
├── ng-package.json
├── package.json
├── tsconfig.json
└── tsconfig.lib.json
```
