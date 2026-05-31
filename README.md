# ngx-xstate

**Angular bindings for [XState v5](https://stately.ai/docs) with first-class [Zod](https://zod.dev) schema integration.**

The Angular equivalent of `@xstate/react`, built on **Angular Signals**, fully **zoneless**, and type-safe end to end.

```ts
const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload, ADD: z.object({ by: z.number() }) },
}).createMachine({
  context: { count: 0 },
  on: {
    INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    // `event` is auto-narrowed per transition key — no manual annotations
    ADD: { actions: assign({ count: ({ context, event }) => context.count + event.by }) },
  },
});

@Component({ /* ... */ })
class CounterComponent {
  private readonly actor = injectActor(counter);
  readonly count = computed(() => this.actor.snapshot().context.count);

  inc() { this.actor.send({ type: 'INC' }); }
  add() { this.actor.send({ type: 'ADD', by: 5 }); } // ✅ payload type-checked
}
```

---

## Why ngx-xstate

- **Signals-native** — actor snapshots are exposed as `Signal<T>`. No `async` pipe, OnPush- and zoneless-compatible.
- **Zod-typed events & context** — declare schemas once; `assign` events are auto-narrowed per transition, and `send()` payloads are fully type-checked.
- **Runtime validation** — events/context/input are validated against your Zod schemas at runtime (no-op by default, `strict: true` to throw).
- **Automatic lifecycle** — actors start on inject and stop on component destroy via `DestroyRef`. Zero boilerplate.
- **State-scoped, type-safe dispatch** — `actor.in('idle').tap(idle => idle.send(...))` is a monadic `case/when` where `send` only accepts the events valid **in that state** (sending an event the state can't handle is a compile error).
- **Named actions / guards** — declared with full XState v5 `params` types preserved.
- **Stately Visualizer devtools** — one provider connects every machine in the app.
- **State tree logging** — render machine structure or a running actor's active states as a plain text tree.

---

## Installation

```bash
npm install ngx-xstate xstate zod
```

**Peer dependencies:**

| Package | Version |
|---|---|
| `@angular/core` | `>=20.0.0` |
| `xstate` | `>=5.0.0` |
| `zod` | `>=3.0.0` |

ngx-xstate is zoneless — bootstrap with `provideZonelessChangeDetection()` (Angular 20+).

---

## Core concept: `typedSetup().createMachine()`

XState's `setup().createMachine()` can't infer `assign` event types from the same config object (TypeScript evaluates the config literal against the generic constraint before it reads `on`). ngx-xstate solves this with a **two-phase API** — the same reason XState itself introduced `setup`:

```ts
import { typedSetup, noPayload } from 'ngx-xstate';
import { assign } from 'xstate';
import { z } from 'zod';

const form = typedSetup({
  //  Phase 1 — declare types with Zod
  context: z.object({ name: z.string(), submitted: z.boolean() }),
  events: {
    SET_NAME: z.object({ value: z.string() }), // event WITH payload
    SUBMIT: noPayload,                          // event WITHOUT payload (= z.object({}))
  },
}).createMachine({
  //  Phase 2 — write the machine config, fully typed
  context: { name: '', submitted: false },
  initial: 'editing',
  states: {
    editing: {
      on: {
        SET_NAME: { actions: assign({ name: ({ event }) => event.value }) },
        SUBMIT: { target: 'done', actions: assign({ submitted: true }) },
      },
    },
    done: { type: 'final' },
  },
});
```

### `def` options (phase 1)

| Field | Type | Description |
|---|---|---|
| `events` | `{ KEY: ZodObject }` | Event name → payload schema. Use `noPayload` for events without a payload. Empty `{}` falls back to `{ type: string }`. |
| `context?` | `ZodTypeAny` | Schema for `context`; types the machine's context. |
| `input?` | `ZodTypeAny` | Schema for actor `input`. |
| `output?` | `ZodTypeAny` | Schema for actor `output`; types `onDone.event.output` when this machine is invoked as a child. Defaults to `z.unknown()`. |
| `actors?` | `Record<string, ActorLogic>` | Logic registered for `invoke`/`spawn`. Reference by name in `invoke.src` (inline logic is not allowed, per `setup`). |
| `actions?` | `Record<string, ActionFn>` | Named actions. The XState v5 `params` type is preserved — reference as `{ type: 'name', params }` or `'name'` in the config. |
| `guards?` | `Record<string, GuardFn>` | Named guards. `params` type preserved, same as actions. |
| `strict?` | `boolean` | `true` → throw on validation failure. Default `false` → warn + no-op (matches XState's behavior for unknown events). |

#### Named actions / guards (params preserved)

```ts
const counter = typedSetup({
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
      guard: { type: 'underMax', params: { max: 10 } }, // params type-checked
      actions: { type: 'bump', params: { amount: 1 } }, // params type-checked
    },
  },
});
```

> **Note:** let the return type be inferred. Adding an explicit type annotation collapses it to `any`.

---

## API reference

### `injectActor(machine, options?)`

Creates, starts, and auto-disposes an actor. Returns reactive accessors.

```ts
const { snapshot, send, actorRef, in: $in } = injectActor(machine, options?);
```

| Returns | Type | |
|---|---|---|
| `snapshot` | `Signal<SnapshotFrom<T>>` | Updated on every transition. |
| `send` | `(event) => void` | Type-checked against the machine's events. |
| `actorRef` | `Actor<T>` | The underlying XState actor. |
| `in` | `(stateName) => Branch` | State-scoped `case/when` matcher (see below). |

**Options:** `input` (static value **or** a function for Signal-connected dynamic input), `inspect`, `snapshot` (restore).

```ts
// Static input
injectActor(machine, { input: { userId: 1 } });

// Dynamic input wired to a Signal
class UserComponent {
  userId = input.required<string>();
  actor = injectActor(machine, { input: () => ({ userId: this.userId() }) });
}
```

### `injectActorRef(machine, options?)`

Like `injectActor` but returns only the `Actor<T>` reference (static input only). Use when you don't need the snapshot Signal.

```ts
const actorRef = injectActorRef(machine, { input: { count: 42 } });
```

### `injectSelector(actorRef, selector)`

Derives a memoized `Signal<T>` from an actor. Uses a **shallow-equal** comparison by default, so the Signal only emits when the selected slice actually changes.

```ts
const count = injectSelector(actorRef, (s) => s.context.count);
```

### `createActorContext(machine)`

Shares one actor across a component subtree via Angular DI — the equivalent of React's `createActorContext`.

```ts
const CounterContext = createActorContext(counterMachine);

// Provide at a route/component
@Component({ providers: [CounterContext.provideActor()] /* ... */ })
class Page {}

// Consume anywhere below
@Component({ /* ... */ })
class Child {
  private readonly actor = CounterContext.injectActorRef();
  readonly count = CounterContext.injectSelector((s) => s.context.count);
}
```

Returns `{ provideActor(options?), injectActorRef(), injectSelector(selector) }`. Calling `injectActorRef()` without a matching `provideActor()` throws.

### `provideXstateDevtools(inspector)`

Registers a global inspector; **every** actor in the app auto-connects. No-op in production (`isDevMode()`).

```ts
// app.config.ts
import { createBrowserInspector } from '@statelyai/inspect';
import { provideXstateDevtools } from 'ngx-xstate';

export const appConfig: ApplicationConfig = {
  providers: [provideXstateDevtools(createBrowserInspector())],
};
```

A per-actor `inspect` option on `injectActor` overrides the global inspector for that actor.

### `renderStateTree(machineOrActor)`

Returns a plain text tree for logging, tests, or quick debugging. Passing a machine renders its static structure; passing a running actor also marks active states with `●`.

```ts
console.log(renderStateTree(machine));

const { actorRef } = injectActor(machine);
console.log(renderStateTree(actorRef));
```

Example output:

```text
checkout ●
├─ cart  (initial)
├─ paying ●
│  ├─ entering ●  (initial)
│  └─ confirming
└─ done  (final)
```

### `actor.in(stateName)` / `matchActor(actorRef)`

A monadic, state-scoped `case/when`. Each branch runs only when the actor is currently in that state, and its `send` is narrowed to the events **valid in that state** — sending anything else is a compile error.

```ts
const actor = injectActor(fetchMachine);

actor
  .in('idle').tap(idle => {
    idle.send({ type: 'FETCH' });   // ✅ valid in 'idle'
    idle.send({ type: 'RESOLVE' }); // ❌ compile error — 'idle' has no RESOLVE transition
  })
  .in('loading').tap(loading => loading.send({ type: 'CANCEL' }))
  .otherwise(() => {/* in neither state */});
```

| Method | On | Returns | Meaning |
|---|---|---|---|
| `.in(name)` | Matcher | `Branch` | Select a state at this level. |
| `.tap(cb)` | Branch | `Matcher` (parent level) | Run `cb` if matched; chain a sibling = `case/when`. |
| `.in(child)` | Branch | `Branch` | Descend into a nested state. |
| `.otherwise(cb)` | Matcher | `void` | `default` clause — runs if no branch matched. |

The `scope` passed to `.tap` is `{ send (narrowed), context (readonly), value }`. Nesting uses `.in().in()`:

```ts
actor.in('loggedIn').in('active').tap(active => active.send({ type: 'GO_IDLE' }));
```

`.in()` reads the current snapshot once (imperative — ideal for event handlers). For actors obtained via `injectActorRef` or `createActorContext`, use the standalone `matchActor(actorRef)`. Only machines built with `typedSetup` carry the per-state typing; a plain `createMachine` machine degrades the state names to `never`.

---

## Runtime validation

Events, context, and input are validated against your Zod schemas at runtime:

- **Default (`strict: false`)** — invalid payloads log a warning and are dropped (no-op), consistent with how XState ignores unknown events.
- **`strict: true`** — invalid payloads `throw`.

```ts
typedSetup({
  events: { ADD: z.object({ by: z.number() }) },
  strict: true,
}).createMachine({ /* ... */ });
```

---

## Full component example

```ts
import { Component, computed } from '@angular/core';
import { assign } from 'xstate';
import { z } from 'zod';
import { typedSetup, noPayload, injectActor } from 'ngx-xstate';

const toggle = typedSetup({
  events: { TOGGLE: noPayload },
}).createMachine({
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { on: { TOGGLE: 'inactive' } },
  },
});

@Component({
  selector: 'app-toggle',
  standalone: true,
  template: `
    <button (click)="actor.send({ type: 'TOGGLE' })">
      {{ isActive() ? 'ON' : 'OFF' }}
    </button>
  `,
})
export class ToggleComponent {
  readonly actor = injectActor(toggle);
  readonly isActive = computed(() => this.actor.snapshot().matches('active'));
}
```

---

## Development

```bash
npm run check        # typecheck + lint + format:check + test
npm run test         # vitest run
npm run build        # ng-packagr
```

Tooling: **vitest** (jsdom, coverage v8), **oxlint** (type-aware) + **oxfmt** for lint/format.

See [`examples/`](./examples) for 18 runnable spec files covering toggle, counter, context, guards, actions, async invoke, compound/parallel/history/final states, delayed transitions, complex multi-machine coordination, devtools, state tree logging, named actions/guards, Zod validation, and state-scoped matching. Design docs live in [`specs/`](./specs).

---

## License

MIT
