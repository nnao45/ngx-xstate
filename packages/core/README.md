# @zstate/core

**Framework-agnostic [XState v5](https://stately.ai/docs) + [Zod](https://zod.dev) type machinery.**

The portable heart of [zstate](../../): a two-phase `typedSetup().createMachine()` that derives a fully-typed event union from Zod schemas, a state-scoped `matchActor` matcher, runtime event validation, and a state-tree renderer. No framework dependency — use it with vanilla TS, Node, or build your own adapter. The Angular adapter is [`@zstate/ngx`](../ngx).

```bash
npm install @zstate/core xstate zod
```

**Peer dependencies:** `xstate >=5.0.0`, `zod >=3.0.0`.

---

## `typedSetup(def).createMachine(config)`

XState's `setup().createMachine()` can't infer `assign` event types from the same config object (TypeScript evaluates the config literal against the generic constraint before it reads `on`). `typedSetup` solves this with a **two-phase API**: declare types with Zod first, then write a fully-typed machine config.

```ts
import { typedSetup, noPayload } from '@zstate/core';
import { assign, createActor } from 'xstate';
import { z } from 'zod';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload, ADD: z.object({ by: z.number() }) },
}).createMachine({
  context: { count: 0 },
  on: {
    INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    // `event` is auto-narrowed per transition key
    ADD: { actions: assign({ count: ({ context, event }) => context.count + event.by }) },
  },
});

const actor = createActor(counter).start();
actor.send({ type: 'ADD', by: 5 }); // ✅ payload type-checked
```

| `def` field | Description |
|---|---|
| `events` | `{ KEY: ZodObject }` — event name → payload schema. `noPayload` (= `z.object({})`) for events without a payload. Empty `{}` falls back to `{ type: string }`. |
| `context?` | Zod schema typing the machine context. |
| `input?` / `output?` | Zod schemas for actor input / output (typed `onDone.event.output` when invoked as a child). |
| `actors?` | Logic registered for `invoke` / `spawn`, referenced by name. |
| `actions?` / `guards?` | Named actions / guards with XState v5 `params` types preserved. |
| `strict?` | `true` → throw on validation failure. Default `false` → warn + no-op. |

> Let the return type be inferred — an explicit annotation collapses it to `any`.

---

## `matchActor(actorRef)`

A monadic, state-scoped `case/when`. Each branch runs only when the actor is currently in that state, and its `send` is narrowed to the events **valid in that state** — sending anything else is a compile error.

```ts
import { matchActor } from '@zstate/core';

matchActor(actor)
  .in('idle', (idle) => idle.send({ type: 'FETCH' }))     // ✅ valid in 'idle'
  .in('loading', (loading) => loading.send({ type: 'CANCEL' }))
  .within('loggedIn', (s) => s.in('active', (a) => a.send({ type: 'GO_IDLE' })))
  .otherwise(() => {/* in none of the above */});
```

`.in(name, scope => …)` matches a state at this level; `.within(name, child => …)` descends into a compound state and re-ascends after the callback; `.otherwise(cb)` is the `default` clause. Machines built without `typedSetup` degrade gracefully: state names still match (derived from the schema), only the per-state `send` narrowing falls back to all events.

---

## `renderStateTree(machineOrActor)`

Returns a plain-text tree for logging/tests. A machine renders its static structure; a running actor also marks active states with `●`.

```ts
console.log(renderStateTree(actor));
// checkout ●
// ├─ cart  (initial)
// └─ paying ●
```

---

## Runtime validation — `validateAndSend(actor, event, schemas)`

Events are validated against the Zod schema attached by `typedSetup` (retrievable via `getSchemas`). Invalid payloads warn + no-op by default, or `throw` when `strict: true`. This is the primitive Angular's `injectActor().send` is built on; adapters for other frameworks can reuse it.

---

## License

MIT
