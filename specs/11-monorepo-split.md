# Monorepo Split — `@zstate/core` + `@zstate/ngx`

## What This Is

現在の単一 `ngx-xstate`（Angular ライブラリ）を、framework-agnostic な **`@zstate/core`** と Angular アダプタ **`@zstate/ngx`** の2パッケージ・モノレポへ分割する設計。型機械（typedSetup / matchActor / renderStateTree / schemas / Zod 検証）は既に Angular 非依存なので core に切り出し、React/Vue 等のアダプタを後付け可能にする。

> Status: grill-me で全枝を合意済み（このドキュメントが合意の確定版）。実装は別フェーズ。

---

## Core Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | core↔ngx 依存 | ngx → core は通常 dependency（caret `^`） | core は唯一のランタイム真実源。複製させない |
| 2 | cross-package ブリッジ | `SCHEMAS_KEY = Symbol.for('@zstate/schemas')` | グローバルシンボルレジストリで dedup-proof。境界をまたぐ attach/get が壊れない |
| 3 | peer deps | `xstate` / `zod` を両 package の peer、`@angular/core` は ngx のみ peer | 利用者が単一バージョンを持つ。二重ロード防止 |
| 4 | monorepo tool | pnpm workspaces（Turbo/Nx なし） | 厳格な node_modules が peer/phantom 漏れを CI で検出。2パッケージに Turbo/Nx は過剰 |
| 5 | core build | tsup（ESM + CJS + .d.ts） | vanilla/Node/他FW どこでも食える dual-format |
| 6 | ngx build | ng-packagr（Angular Package Format） | partial-Ivy。tsup では正しい Angular lib を吐けない |
| 7 | build order | core → ngx | ngx が core の .d.ts を要求。`pnpm -r build` がトポロジカル順で自動解決 |
| 8 | dev/test 解決 | tsconfig `paths` で `@zstate/core` → `packages/core/src` | ソース直参照。テスト時に core を再ビルド不要。公開 `exports` は dist |
| 9 | coverage | package 独立で各 100%（合算しない） | 境界の責任が明確 |
| 10 | versioning | Locked / fixed（changesets） | `@angular/*` と同じメンタルモデル。core/ngx 常に同番 |
| 11 | release | changesets/action + npm provenance(OIDC) | Version PR → マージで publish。供給元証明 |
| 12 | repo 名 | `ngx-xstate` → `zstate` にリネーム | GitHub 自動リダイレクトで被害小 |
| 13 | 既存 ngx-xstate | 未 publish → deprecate 不要 | `@zstate/{core,ngx}` を新規 publish、0.1.0 始動 |

---

## Boundary — どっちに置くか

### `@zstate/core`（framework-agnostic）

| ファイル | 内容 |
|---|---|
| `typed-machine.ts` | `typedSetup`, `noPayload` |
| `typed-machine-types.ts` | `EventsMap`, `EventUnionFromMap` |
| `state-match.ts` | `matchActor`, `Matcher`/`Branch`/`StateScope`, `STATE_TREE`, `StateTreeOf`, `WithStateTree`, `StateMatcherFor`, `buildStateMatcher` |
| `render-state-tree.ts` | `renderStateTree` |
| `schemas.ts` | `attachSchemas`, `getSchemas`, `SchemasPayload`, **`SCHEMAS_KEY`** |
| `validate.ts`（**移動**） | `validateAndSend`（inject-actor-ref から切り出し。Zod 検証の本体） |
| `shallow-equal.ts`（**移動**） | `shallowEqual`（将来の他FW selector も使う） |
| `devtools-types.ts`（**新規**） | `XStateInspector` interface（型のみ） |
| `types.ts`（一部） | `SendEvent`（agnostic 部分のみ core へ） |

### `@zstate/ngx`（Angular アダプタ）

| ファイル | 内容 |
|---|---|
| `inject-actor.ts` | `injectActor` |
| `inject-actor-ref.ts` | `injectActorRef`, `buildActorOptions`（純粋だが wrapper 専用で据え置き） |
| `inject-selector.ts` | `injectSelector`（core の `shallowEqual` を import） |
| `create-actor-context.ts` | `createActorContext` |
| `devtools.ts` | `provideXstateDevtools` + `XSTATE_INSPECTOR` token（interface は core から import） |
| `types.ts` | `InjectActorOptions`, `InjectActorReturn`, `ActorContext` |

**判断基準:** 純粋 ＆ 再利用価値あり（validateAndSend / shallowEqual / XStateInspector / SendEvent）は core。純粋でも wrapper 生成専用で再利用価値が薄い（buildActorOptions）は ngx。

---

## Runtime Correctness

- **`SCHEMAS_KEY`**: 現状 `Symbol('ngxXstateSchemas')`（モジュールローカル）→ `Symbol.for('@zstate/schemas')` に変更。これが分割で**実コードを触る唯一の正しさ要件**。typedSetup（core）が attach し getSchemas（core）が read するが、ngx 側のラッパーも同じシンボルを介して参照するため、グローバルレジストリ経由で dedup されないと壊れる。
- **`STATE_TREE`**: `export declare const ... : unique symbol`（型のみ・実体なし）。境界をまたいでも実行時に存在しないので安全。

---

## Directory Layout

```
zstate/                              ← repo (renamed from ngx-xstate)
├── package.json                     ← workspace root (private)
├── pnpm-workspace.yaml              ← packages/*
├── tsconfig.base.json               ← 共有 compilerOptions + paths(@zstate/core→src)
├── .oxlintrc.json                   ← ルート1つを継承
├── .oxfmtrc.json
├── vitest.workspace.ts              ← core/ngx の projects を集約
├── .changeset/                      ← changesets 設定（fixed）
├── .github/workflows/release.yml    ← changesets/action + provenance
├── README.md                        ← monorepo 概要
├── specs/                           ← 設計仕様（このディレクトリ）
└── packages/
    ├── core/
    │   ├── package.json             ← @zstate/core
    │   ├── tsup.config.ts
    │   ├── tsconfig.json / .spec.json
    │   ├── vitest.config.ts         ← environment: node
    │   ├── README.md
    │   ├── src/
    │   │   ├── lib/{typed-machine,typed-machine-types,state-match,
    │   │   │        render-state-tree,schemas,validate,shallow-equal,
    │   │   │        devtools-types}.ts
    │   │   └── public-api.ts
    │   └── examples/                ← 純粋系 spec（typedSetup 推論 / renderStateTree(machine) /
    │                                   matchActor(素machine) / Zod 検証単体）
    └── ngx/
        ├── package.json             ← @zstate/ngx
        ├── ng-package.json
        ├── tsconfig.json / .lib.json / .spec.json
        ├── vitest.config.ts         ← jsdom + @angular/core/testing + zoneless
        ├── README.md
        ├── src/
        │   ├── lib/{inject-actor,inject-actor-ref,inject-selector,
        │   │        create-actor-context,devtools,types}.ts
        │   └── public-api.ts
        └── examples/                ← コンポーネント/TestBed/E2E 系（19, 20, inject* 等）
```

---

## `packages/core/package.json`

```json
{
  "name": "@zstate/core",
  "version": "0.1.0",
  "description": "Framework-agnostic XState v5 + Zod type machinery",
  "keywords": ["xstate", "state-machine", "zod", "typescript"],
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "publishConfig": { "access": "public", "provenance": true },
  "peerDependencies": {
    "xstate": ">=5.0.0",
    "zod": ">=3.0.0"
  }
}
```

## `packages/ngx/package.json`

```json
{
  "name": "@zstate/ngx",
  "version": "0.1.0",
  "description": "Angular bindings for XState v5 with Zod, built on Signals (zoneless)",
  "keywords": ["angular", "xstate", "signals", "zod", "zoneless"],
  "license": "MIT",
  "publishConfig": { "access": "public", "provenance": true },
  "dependencies": {
    "@zstate/core": "^0.1.0"
  },
  "peerDependencies": {
    "@angular/core": ">=20.0.0",
    "xstate": ">=5.0.0",
    "zod": ">=3.0.0"
  }
}
```

> `dependencies` の `@zstate/core` は workspace 内では pnpm が `workspace:^` で symlink、publish 時に changesets が実バージョン（caret）へ書き換える。

---

## tsconfig 戦略

- `tsconfig.base.json`（ルート）: strict 系・moduleResolution・`paths: { "@zstate/core": ["packages/core/src/public-api.ts"] }`
- 各 package の `tsconfig.json` が extends。**ngx の ng-packagr ビルド（tsconfig.lib.json）では paths を解除**し、`@zstate/core` を外部依存として node_modules（pnpm symlink → core/dist）から解決させる ＝ build 時は dist、dev/test 時は src。

---

## Testing / Typecheck

| | `@zstate/core` | `@zstate/ngx` |
|---|---|---|
| vitest env | node | jsdom + @angular/core/testing + zoneless |
| coverage | v8、core/src のみ 100% | v8、ngx/src のみ 100% |
| typecheck | 素の `tsc`（lib + spec） | `tsc`（Angular型・lib + spec） |
| examples | 純粋系 | コンポーネント/E2E 系 |

- ルート `vitest.workspace.ts` で両 project を集約 → `pnpm test` で一括。
- `pnpm -r typecheck` / `pnpm -r build`（トポロジカル: core→ngx）。
- oxlint/oxfmt はルート1設定を全 package で共有（type-aware 維持）。

---

## Release

- **changesets**, fixed/locked versioning（`.changeset/config.json` の `fixed: [["@zstate/core", "@zstate/ngx"]]`）。core/ngx は常に同一バージョン。
- GitHub Actions `changesets/action`: PR に changeset → main マージで "Version Packages" PR 自動生成 → それをマージで両 package を npm publish。
- npm provenance（`--provenance` / publishConfig）を GH OIDC で付与。
- 開始バージョン **0.1.0**（pre-1.0、破壊的変更可）。

---

## Migration Notes

- 既存 `ngx-xstate` は **未 publish** のため deprecate 不要。`@zstate/{core,ngx}` を新規に publish。
- repo `nnao45/ngx-xstate` → `nnao45/zstate` リネーム（GitHub 自動リダイレクト）。
- 移設は機械的: `src/lib/*` を境界表に従って `packages/{core,ngx}/src/lib/` へ振り分け、import を `@zstate/core` 経由に書き換え、`SCHEMAS_KEY` を `Symbol.for` 化、各 public-api.ts を再構成。
```
