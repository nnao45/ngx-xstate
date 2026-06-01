# @zstate/react

**React bindings for [XState v5](https://stately.ai/docs) with first-class [Zod](https://zod.dev) schema integration.**

The React equivalent of `@xstate/react`, built on `useSyncExternalStore`, SSR- and StrictMode-safe, and type-safe end to end. The React adapter of the framework-agnostic [`@zstate/core`](../core) — which it re-exports, so `typedSetup`, `matchActor`, and `renderStateTree` are available from `@zstate/react` directly.

```tsx
const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload, ADD: z.object({ by: z.number() }) },
}).createMachine({
  context: { count: 0 },
  on: {
    INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    ADD: { actions: assign({ count: ({ context, event }) => context.count + event.by }) },
  },
});

function Counter() {
  const { snapshot, send } = useActor(counter);
  return (
    <button onClick={() => send({ type: 'ADD', by: 5 })}>
      {snapshot.context.count}
    </button>
  );
}
```

---

## Why @zstate/react

- **`useSyncExternalStore`-native** — tearing-free under concurrent React, SSR-ready (`getServerSnapshot`), and StrictMode-safe (actors are recreated rather than left dead on remount).
- **Zod-typed events & context** — declare schemas once; `assign` events are auto-narrowed per transition, and `send()` payloads are fully type-checked.
- **Runtime validation** — events/input are validated against your Zod schemas (no-op by default, `strict: true` to throw).
- **State-scoped, type-safe dispatch** — `actor.in('idle', idle => idle.send(...))` only accepts the events valid **in that state**; `.within('parent', s => ...)` descends into compound states. Same API as `@zstate/ngx`.
- **Selectors** — `useSelector(actorRef, selector)` with a `shallowEqual` default.
- **Shared actors** — `createActorContext(machine)` → `{ Provider, useActorRef, useSelector }`.
- **Devtools** — one `<XStateDevtoolsProvider>` connects every actor underneath to the Stately Visualizer; no-op in production.

---

## Installation

```bash
npm install @zstate/react xstate zod
```

`@zstate/core` is pulled in automatically.

**Peer dependencies:**

| Package | Version |
|---|---|
| `react` | `>=18.0.0` |
| `xstate` | `>=5.0.0` |
| `zod` | `>=3.0.0` |

---

## API

| Hook / Component | Signature |
|---|---|
| `useActor(machine, options?)` | `→ { snapshot, send, actorRef, in, within }` — snapshot is a value (re-renders on transition) |
| `useActorRef(machine, options?)` | `→ Actor<T>` (static input) |
| `useSelector(actorRef, selector, compare?)` | `→ T` (default `shallowEqual`) |
| `createActorContext(machine, defaultOptions?)` | `→ { Provider, useActorRef, useSelector }` |
| `<XStateDevtoolsProvider inspector>` | global inspector for every actor underneath |

`input` is captured once at creation (static). To reset on prop change, remount via React `key`. For an already-created `actorRef` (from `useActorRef`/`createActorContext`), use the core `matchActor(actorRef)` for state-scoped dispatch.

> **Server Components:** `@zstate/react` is a client adapter (hooks). It does **not** ship a `'use client'` directive — import it from client components, and import server-safe machine definitions (`typedSetup`) from `@zstate/core` directly when needed on the server.

---

## Development

This package lives in the [`zstate`](../../) pnpm monorepo. From the repo root:

```bash
pnpm run check                       # build + typecheck + lint + format:check + test (all packages)
pnpm --filter @zstate/react test     # vitest run for this package
pnpm --filter @zstate/react build    # tsup
```

Tooling: **vitest** (jsdom, coverage v8, 100%) + **@testing-library/react**, **oxlint** (type-aware) + **oxfmt**. StrictMode double-mount and SSR (`renderToString`) are covered explicitly. See [`examples/`](./examples) for runnable spec files.

## License

MIT
