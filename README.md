# zstate

**Type-safe [XState v5](https://stately.ai/docs) + [Zod](https://zod.dev), from a framework-agnostic core to Angular and React adapters.**

A pnpm monorepo of three packages:

| Package | What it is | Build |
|---|---|---|
| [**`@zstate/core`**](./packages/core) | Framework-agnostic type machinery: `typedSetup`, `matchActor`, `renderStateTree`, runtime validation. Use with vanilla TS, Node, or any framework. | tsup (ESM + CJS + dts) |
| [**`@zstate/ngx`**](./packages/ngx) | Angular bindings built on Signals, fully zoneless. Re-exports `@zstate/core`. | ng-packagr |
| [**`@zstate/react`**](./packages/react) | React bindings built on `useSyncExternalStore`, SSR- and StrictMode-safe. The Zod-typed counterpart to `@xstate/react`. Re-exports `@zstate/core`. | tsup (ESM + CJS + dts) |

All three packages are released together under a single **locked** version (like `@angular/*`).

```ts
// One Zod-typed declaration, end-to-end type safety:
const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { ADD: z.object({ by: z.number() }) },
}).createMachine({
  context: { count: 0 },
  on: { ADD: { actions: assign({ count: ({ context, event }) => context.count + event.by }) } },
});

// Vanilla (@zstate/core):
createActor(counter).start().send({ type: 'ADD', by: 5 });

// Angular (@zstate/ngx):
const actor = injectActor(counter);
actor.send({ type: 'ADD', by: 5 }); // ✅ payload type-checked, Signal snapshot

// React (@zstate/react):
const { snapshot, send } = useActor(counter);
send({ type: 'ADD', by: 5 }); // ✅ payload type-checked, useSyncExternalStore
```

---

## Development

Requires [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm run check        # build + typecheck + lint + format:check + test (all packages)
pnpm run build        # tsup (core) → ng-packagr (ngx), topological order
pnpm test             # all tests; coverage is per-package, each 100%
```

| Concern | core | ngx | react |
|---|---|---|---|
| Test env | vitest (node) | vitest (jsdom + `@angular/core/testing`, zoneless) | vitest (jsdom + `@testing-library/react`) |
| Coverage | 100% | 100% | 100% |
| Dev resolution | — | `@zstate/core` → core source (no rebuild) | `@zstate/core` → core source (no rebuild) |

Lint/format: **oxlint** (type-aware) + **oxfmt**. Design docs live in [`specs/`](./specs) — see [`11-monorepo-split.md`](./specs/11-monorepo-split.md) for the package boundary and [`12-react-adapter.md`](./specs/12-react-adapter.md) for the React adapter.

## Releasing

Versioned with [changesets](https://github.com/changesets/changesets) (locked: core, ngx and react always share a version). Add a changeset with `pnpm changeset`; merging to `main` opens a "Version Packages" PR, and merging that publishes all packages to npm with provenance.

## License

MIT
