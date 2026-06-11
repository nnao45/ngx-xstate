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

A state-scoped `case/when` chain with value-returning fold and [Cats Effect](https://typelevel.org/cats-effect/)–style monadic methods. Each `.in()` branch runs only when the actor is in that state, and its `send` is narrowed to events **valid in that state** — sending anything else is a compile error.

### Imperative chain (side effects)

```ts
import { matchActor } from '@zstate/core';

matchActor(actor)
  .in('idle',    idle    => idle.send({ type: 'FETCH' }))   // ✅ FETCH valid in idle only
  .in('loading', loading => loading.send({ type: 'CANCEL' }))
  .within('loggedIn', s  => s.in('active', a => a.send({ type: 'GO_IDLE' })))
  .inAny(['idle', 'success'], s => console.log(s.value))
  .when(ctx => ctx.retries > 3, () => alert('Too many retries'))
  .done(ctx => console.log('Finished:', ctx.result))
  .otherwise(() => console.log('no match'));
```

Machines built without `typedSetup` degrade gracefully: state names still match, only the per-state `send` narrowing falls back to accepting all events.

### `.fold(cases)` — value-returning pattern match

```ts
const label = matchActor(actor).fold({
  idle:    ()  => 'Ready',
  loading: (s) => `Loading (retry ${s.context.retries})`,
  success: ()  => 'Done',
  _:       ()  => 'Unknown',  // _ guarantees T (no undefined)
});
```

### Cats Effect–style monadic methods

| Method | Cats analogue | Summary |
|--------|--------------|---------|
| `.collect(cases)` | `Foldable.toList` | Gathers **all** matches into `T[]` — use with parallel states |
| `.pipe(f1, f2?, …)` | `Kleisli` / Arrow | Threads the `Matcher` through up to 4 transform fns |
| `.tapAlways(cb)` | `FlatMap.flatTap` | Runs `cb(ctx)` always without touching `matched` — for logging/telemetry |
| `.map(fn)` | `Functor.map` | Transforms context type; downstream `in`/`fold`/`when` see `fn(ctx)` |
| `.foldMap(monoid, cases)` | `Foldable.foldMap` | Aggregates **all** matches via a monoid |
| `.orElse(factory)` | `Alternative.orElse` | When unmatched, delegates to `factory()` — composable fallbacks |
| `.filter(pred)` | `FunctorFilter.filter` | Gates entire chain; `false` skips `otherwise` too |
| `.attempt(cases)` | `IO.attempt` | Like `fold` but returns `{ ok, value/error }` — never throws |
| `.zip(casesA, casesB)` | `Apply.product` | Evaluates two independent fold sets in one snapshot pass |
| `.flatMap(fn)` | `FlatMap.flatMap` | When unmatched, replaces active `Matcher` with `fn(ctx)` |

**Examples:**

```ts
// zip — derive two values (label + CSS class) from one snapshot
const [label, cls] = matchActor(actor).zip(
  { idle: () => 'Ready',   loading: () => 'Busy',    _: () => '...' },
  { idle: () => 'btn-ok',  loading: () => 'btn-spin', _: () => 'btn-muted' },
);

// attempt — catch handler exceptions into { ok, value/error }
const result = matchActor(actor).attempt({
  loaded: (s) => JSON.parse(s.context.rawPayload),  // may throw
  _:      ()  => null,
});
if (!result.ok) logger.error(result.error);

// filter — feature-flag gate on entire chain
matchActor(actor)
  .filter(ctx => ctx.featureFlags.includes('NEW_UI'))
  .in('idle',    () => renderNewUI())
  .in('loading', () => renderNewSpinner())
  .otherwise(     () => renderLegacyUI());

// orElse — composable fallback across actors
matchActor(primaryActor)
  .in('ready', (s) => dispatch(s))
  .orElse(() => matchActor(fallbackActor).in('ready', (s) => dispatch(s)));

// map — transform context into a view-model
matchActor(actor)
  .map(ctx => ({ title: ctx.name.toUpperCase(), isAdmin: ctx.role === 'admin' }))
  .in('dashboard', (s) => render(s.context.title, s.context.isAdmin));

// tapAlways — logging lane that never affects matched
matchActor(actor)
  .tapAlways(ctx => analytics.track('state-match', ctx))
  .in('error', () => showErrorBanner())
  .otherwise(() => showDefault());

// foldMap — aggregate all active states with a monoid
const sumMonoid = { empty: 0, combine: (a: number, b: number) => a + b };
const score = matchActor(actor).foldMap(sumMonoid, {
  idle: () => 0, loading: () => 1, error: () => 5,
});

// collect — T[] of all matching states (parallel state support)
const labels = matchActor(actor).collect({
  running: () => 'Running',
  paused:  () => 'Paused',
});

// pipe — compose reusable behavior modules
const withLoading = (m: Matcher) => m.in('loading', () => showSpinner());
const withError   = (m: Matcher) => m.in('error',   () => showBanner());
matchActor(actor).pipe(withLoading, withError);

// flatMap — dynamic Matcher selection from context
matchActor(actor).flatMap(ctx =>
  ctx.role === 'admin'
    ? matchActor(actor).in('dashboard', () => renderAdminDash())
    : matchActor(actor).in('dashboard', () => renderUserDash()),
);
```

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
