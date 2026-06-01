# React Adapter — `@zstate/react`

## What This Is

`@zstate/core` の上に載る **React アダプタ**。`@zstate/ngx`（Angular）に対応する位置づけで、`useActor` / `useActorRef` / `useSelector` / `createActorContext` フックと state-scoped `.in`/`.within`、Zod ランタイム検証 send、devtools を提供する。`@xstate/react` の React 版に相当しつつ、zstate の二段階 `typedSetup` + Zod 型安全 + 状態スコープ send を第一級で出す。

> Status: grill-me で全枝を合意 → **実装完了（2026-06-01）**。`pnpm run check` グリーン（3パッケージ build/typecheck/lint/format + 249 tests）、React パッケージ カバレッジ 100%（lib 5ファイル + 11 examples）。

## 実装で判明した要注意点（ハマりどころ）

- **StrictMode**: XState v5 actor は `stop()` 後に再 `start()` しても **'stopped' のまま蘇らない**（v4 と違い「再 start で初期化」はされない）。素朴な `useState(create)+useEffect(start/stop)` だと StrictMode 二重マウントで死んだ actor を掴む。→ effect 内で `getSnapshot().status === 'stopped'` を検知したら `setActorRef(create())` で**作り直す**。生成パラメータは ref 保持、`create` は `useCallback([])` で安定化。本番（単一マウント）では再生成は発火しない
- **tsup dts**: `@zstate/core` を dist から解決するため、generic な `SnapshotFrom<TLogic>` に `.status` が無いと型エラー。`(actorRef.getSnapshot() as { status: string }).status` でアサート（no-unsafe-type-assertion は off）
- **tsup は各 package の devDep に必要**（pnpm 分離。core にあっても react には別途要る）
- **oxlint**: override の glob が `.ts` のみだと `.tsx` の spec/examples に当たらない → `**/*.spec.tsx`, `**/examples/**/*.tsx`, `**/test-setup.ts` を追加。JSX イディオム（`onClick={() => send()}` 等）が `typescript/no-confusing-void-expression`・`strict-void-return`・`no-unnecessary-type-conversion` を誘発するので spec/examples override で off。`unicorn/consistent-function-scoping`（test 内ネストコンポーネント）・`import/no-unassigned-import`（test-setup の jest-dom 副作用 import）も off
- **oxfmt/format スクリプト**は `.ts` だけでなく `.tsx` も対象に（ルート package.json）
- **RTL のテスト**: native `element.click()` は act 外で state を flush しない → `fireEvent.click()` を使う
- `Provider` の `logic?: TLogic` override は**同型 machine のみ**（別 config の machine は STATE_TREE ブランドが違い代入不可。設計上の制約）

---

## Core Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | 戻り値の形 | オブジェクト `{ snapshot, send, actorRef, in, within }` + `useActor` | ngx と同形。状態スコープ `.in`/`.within` を第一級で出せる。クロスアダプタで学習一本化 |
| 2 | snapshot 露出 | **値**（`useSyncExternalStore` が直接返す） | React イディオム。ngx の `Signal`（関数）とは形が違うが各 FW の流儀に従う |
| 3 | 購読機構 | `useSyncExternalStore` + `getServerSnapshot`（SSR） | tearing/concurrent 安全。XState の snapshot は遷移時のみ新参照で `Object.is` と相性良 |
| 4 | selector | `useSyncExternalStoreWithSelector`（`use-sync-external-store/with-selector`）、デフォルト `shallowEqual` | ngx の `injectSelector` デフォルトと一致。shim は `@xstate/react` も依存する実績物 |
| 5 | actor ライフサイクル | **`@xstate/react` v5 のライフサイクルを移植** | XState actor は stop 後再 start 不可。StrictMode/concurrent/SSR は誤りやすい → 本番実績パターンに乗る。その上に zstate 独自層を被せる |
| 6 | `input` | 生成時に1度捕捉（静的） | reactive 再生成は状態リセットの罠＝React アンチパターン。変えたい時は `key` 再マウント |
| 7 | `.in` / `.within` | ngx 同形の imperative 一発読み（`actorRef.getSnapshot()` ライブ読み + `validateAndSend`）、`useCallback` 安定化 | 再レンダー+ライブ読みで render 時・ハンドラ時の両対応。reactive 専用 API は不要 |
| 8 | `createActorContext` | `{ Provider, useActorRef, useSelector }`（Provider はコンポーネント） | ngx（ref+selector のみ）と `@xstate/react`（Provider）の交差点。full `useActor` は context に出さない（selector 推奨思想） |
| 9 | devtools | `<XStateDevtoolsProvider inspector>`（Context、全フック自動接続、per-hook override、prod no-op） | ngx の `provideXstateDevtools`「1つ置けば全 actor 接続」を React イディオムで再現 |
| 10 | peer 依存 | `react >=18`, `xstate >=5`, `zod >=3`。`@zstate/core`+`use-sync-external-store` は通常 dep。react-dom は devDep | `useSyncExternalStore` 下限=18。フックライブラリは react のみ peer（`@xstate/react` 同様） |
| 11 | ビルド | tsup（ESM+CJS+dts）。`'use client'` は付けない | core 再エクスポート（`typedSetup` 等サーバー安全 API）が client 強制される footgun を回避。将来オプトイン可 |
| 12 | リリース | changeset `fixed` を `[core, ngx, react]` の3パッケージロックに拡張、0.1.0 | locked versioning（`@angular/*` 流）。3つ常に同番 |
| 13 | テスト | vitest(jsdom) + `@testing-library/react` + `@testing-library/jest-dom`、StrictMode/SSR を明示テスト | RTL が React 標準。ライフサイクル移植の正しさ（二重マウント・ハイドレーション）を spec で担保 |
| 14 | examples | 厚め（ngx 20本相当の React 版）、coverage 対象外 | ショーケース。RTL で実コンポーネント駆動 |
| 15 | カバレッジ | package 独立で 100%（lib コロケート `*.spec.tsx` 駆動） | 境界の責任明確（core/ngx と同方針） |

---

## Public API

```ts
// @zstate/react public-api
export * from '@zstate/core';            // typedSetup, noPayload, matchActor, renderStateTree, …

export { useActor } from './use-actor';
export { useActorRef } from './use-actor-ref';
export { useSelector } from './use-selector';
export { createActorContext } from './create-actor-context';
export { XStateDevtoolsProvider } from './devtools';

export type { UseActorOptions, UseActorReturn, ActorContext } from './types';
```

| API | シグネチャ | 対応する ngx |
|---|---|---|
| `useActor` | `(machine, options?) → { snapshot, send, actorRef, in, within }` | `injectActor` |
| `useActorRef` | `(machine, options?) → Actor<T>`（静的 input） | `injectActorRef` |
| `useSelector` | `(actorRef, selector, compare?=shallowEqual) → T` | `injectSelector` |
| `createActorContext` | `(machine, defaultOptions?) → { Provider, useActorRef, useSelector }` | `createActorContext` |
| `XStateDevtoolsProvider` | `<… inspector={XStateInspector}>` | `provideXstateDevtools` |

- `useActor` は machine/logic を受けて生成・所有（既存 actorRef は受けない → `useSelector` + `matchActor`）
- `send` / `.in` / `.within` は `useCallback` 安定参照、snapshot は値
- 型名は `Use*` プレフィックスで ngx の `Inject*` と鏡写し

---

## Reactivity / Lifecycle（実装方針）

- `useActorRef`: `useState` で actor を lazy 生成（idle）。`useEffect` で `start()`、cleanup で `stop()`。XState actor は再 start 不可のため、StrictMode 二重マウントは `@xstate/react` 移植ロジックで安全に扱う（必要なら再生成）。devtools Context の inspector を読んで `createActor` の `inspect` に流す（per-hook `inspect` 優先）。input は生成時に Zod 検証（1回）
- `useActor`: `useActorRef` + `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` で snapshot を購読。`send` は `validateAndSend(actorRef, event, getSchemas(machine))`。`.in`/`.within` は `buildStateMatcher` を `actorRef.getSnapshot()` ライブ + 検証付き send で包む（`useCallback`）
- `useSelector`: `useSyncExternalStoreWithSelector(subscribe, getSnapshot, getServerSnapshot, selector, compare=shallowEqual)`
- SSR: `getServerSnapshot` に `actorRef.getSnapshot()` を渡しハイドレーション不整合を防ぐ

---

## Monorepo 組み込み

```
packages/react/
├── package.json            ← @zstate/react（dep: @zstate/core workspace:^, use-sync-external-store；peer: react>=18, xstate, zod）
├── tsup.config.ts          ← ESM+CJS+dts（'use client' なし）
├── tsconfig.json / .spec.json
├── vitest.config.ts        ← jsdom + setup(afterEach cleanup) + alias @zstate/core→../core/src
├── README.md
├── src/
│   ├── lib/{use-actor,use-actor-ref,use-selector,create-actor-context,devtools,types}.ts(x)
│   └── public-api.ts
└── examples/               ← React 版ショーケース（RTL 駆動、coverage 外）
```

- ルート集約は core/ngx と同様（tsconfig.base を extends、oxlint/oxfmt 共有）。**oxlint type-aware は tsconfig paths を無視するため、lint 前に `@zstate/core` を build 必須**（ルート `check` は build 始まり済み）
- `pnpm -r build` のトポロジカル順に react が乗る（core → {ngx, react}）
- changeset `.changeset/config.json` の `fixed` を3パッケージに拡張

---

## `@xstate/react` との関係

- **差別化**: 二段階 `typedSetup`（Zod から event union 導出）、`send` の Zod ランタイム検証、状態スコープ型安全 `.in`/`.within`、`renderStateTree`、core 共有による Angular 等とのクロスアダプタ一貫
- **非互換（意図的）**: 戻り値はタプルでなくオブジェクト、`useActor` は machine 専用、reactive input なし
- **踏襲**: `useSyncExternalStore` ベースの購読・SSR・StrictMode ライフサイクルは本家の検証済みパターンを移植
