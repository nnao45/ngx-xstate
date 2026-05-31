# Lint & Format Tooling

## Decision

Rust-based **oxlint** + **oxfmt** (oxc toolchain). ESLint / typescript-eslint
は完全に削除。

| 旧 | 新 |
|---|---|
| `eslint` + `typescript-eslint` | `oxlint` |
| (Prettier 未使用) | `oxfmt` |
| `eslint.config.js` | `.oxlintrc.json` + `.oxfmtrc.json` |

理由: oxlint/oxfmt は Rust 製で桁違いに速い（全ファイル数十ms）。設定が
JSON 一枚で完結し、CI も軽い。

---

## oxlint — `.oxlintrc.json`

### 有効カテゴリ（すべて `error`）

| category | 内容 |
|---|---|
| `correctness` | 明確に誤り・無意味なコード |
| `suspicious` | ほぼ確実に誤り |
| `perf` | より高速に書けるコード |
| `pedantic` | 厳格（稀に誤検出） |

### 有効プラグイン

`typescript` / `unicorn` / `oxc` / `import` / `promise`

### 明示ルール

```jsonc
"typescript/no-explicit-any": "error",        // any は一切禁止（プロジェクト鉄則）
"typescript/no-non-null-assertion": "error",  // ! 禁止
"typescript/consistent-type-imports": "error",
"eqeqeq": ["error", "always", { "null": "ignore" }], // == null 慣用は許可
"import/no-default-export": "error",          // named export 強制（spec/examples は除外）
"max-lines-per-function": ["error", 80]
```

### 意図的に無効化したルール（なぜ）

| rule / category | 無効化理由 |
|---|---|
| `style` カテゴリ | `sort-keys` が XState の machine 定義（`context`→`states`、`INCREMENT`→`DECREMENT` の自然な並び）をアルファベット順に破壊するため。ステートチャートの可読性を優先。 |
| `vitest` プラグイン | `prefer-expect-assertions`（全テストに `expect.hasAssertions()` 要求）、`no-hooks`（`beforeEach` 禁止）など、テストの書き方を過剰に縛るため。 |
| `no-inline-comments` | examples は教材。行末コメントで状態遷移を解説する価値が高い。 |
| `no-console` | ライブラリは Zod 検証失敗時に意図的に `console.warn`（no-op 思想）。 |
| `unicorn/no-useless-undefined` | テストの `mockImplementation(() => undefined)` を許容。 |

「がちがち（最大限厳格）」だが、**ドメインに敵対するルールは外す**という方針。

---

## oxfmt — `.oxfmtrc.json`

Prettier 互換。既存コードに合わせた正準スタイル:

```jsonc
"printWidth": 100,
"tabWidth": 2,
"singleQuote": true,
"semi": true,
"trailingComma": "all",
"arrowParens": "always",
"endOfLine": "lf",
"insertFinalNewline": true
```

フォーマッタが唯一の正準。エディタ差異（4-space / double-quote 等）は
`oxfmt --write` で全ファイル統一される。

---

## npm scripts

```jsonc
"lint":         "oxlint --deny-warnings src examples",
"format":       "oxfmt --write 'src/**/*.ts' 'examples/**/*.ts'",
"format:check": "oxfmt --check 'src/**/*.ts' 'examples/**/*.ts'",
"check":        "npm run typecheck && npm run lint && npm run format:check && npm run test"
```

`--deny-warnings` で警告も exit code 非ゼロにし、CI を赤くする。

---

## Type-aware リント（oxlint-tsgolint）

`oxlint-tsgolint` を入れて `options.typeAware: true` で型認識リントを有効化。
TS-Go ネイティブエンジンで型情報を使い、`no-unsafe-*` 系を解析する。

```jsonc
"options": { "typeAware": true },
"rules": {
  "typescript/no-unsafe-assignment": "error",
  "typescript/no-unsafe-call": "error",
  "typescript/no-unsafe-return": "error",
  "typescript/no-unsafe-member-access": "error",
  "typescript/no-unsafe-argument": "error",
  "typescript/no-floating-promises": "error",
  "typescript/no-unsafe-type-assertion": "off",      // 内部の Zod↔XState ブリッジ用 as を許可
  "typescript/prefer-readonly-parameter-types": "off" // 過剰
}
```

### tsgolint の前提

- tsgolint の TS-Go エンジンは `baseUrl` / `downlevelIteration` を拒否するため
  `tsconfig.json` から削除済み（ES2022 では両方とも不要）。

### spec/examples で no-unsafe-* を緩める理由

XState の `invoke` の `onDone.event.output` / `onError.event.error` は、actors を
登録しても **tsgolint(TS-Go) の推論が tsc に追いつかず any と誤判定**することがある
（`tsc --strict` では正しく型付く）。テスト/デモコードでこの誤検出に振り回されない
よう、`**/*.spec.ts` と `examples/**` では `no-unsafe-return` /
`no-unsafe-member-access` / `no-unsafe-argument` を off にする。
**ライブラリ本体（src/lib の非 spec）は全 no-unsafe を厳格維持。**

---

## 型安全の最終ゲートは tsc

oxlint type-aware（tsgolint）は補助。型レベルの真のゲートは **`tsc --strict`**
（`tsconfig.lib.json` + `tsconfig.spec.json`）。`npm run typecheck` が lib と
spec/examples の両方を tsc にかける。tsgolint と tsc で推論差がある場合は
**tsc を正**とする。
