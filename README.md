# zstate

**Type-safe [XState v5](https://stately.ai/docs) + [Zod](https://zod.dev), from a framework-agnostic core to an Angular adapter.**

A pnpm monorepo of two packages:

| Package | What it is | Build |
|---|---|---|
| [**`@zstate/core`**](./packages/core) | Framework-agnostic type machinery: `typedSetup`, `matchActor`, `renderStateTree`, runtime validation. Use with vanilla TS, Node, or any framework. | tsup (ESM + CJS + dts) |
| [**`@zstate/ngx`**](./packages/ngx) | Angular bindings built on Signals, fully zoneless. The Angular equivalent of `@xstate/react`. Re-exports `@zstate/core`. | ng-packagr |

The two packages are released together under a single **locked** version (like `@angular/*`).

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

| Concern | core | ngx |
|---|---|---|
| Test env | vitest (node) | vitest (jsdom + `@angular/core/testing`, zoneless) |
| Coverage | 100% (`@zstate/core`) | 100% (`@zstate/ngx`) |
| Dev resolution | — | `@zstate/core` → core source (no rebuild) |

Lint/format: **oxlint** (type-aware) + **oxfmt**. Design docs live in [`specs/`](./specs) (see [`11-monorepo-split.md`](./specs/11-monorepo-split.md) for the package boundary).

## Releasing

Versioned with [changesets](https://github.com/changesets/changesets) (locked: core and ngx always share a version). Add a changeset with `pnpm changeset`; merging to `main` opens a "Version Packages" PR, and merging that publishes both packages to npm with provenance.

## License

MIT
