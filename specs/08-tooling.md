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

## 型安全の最終ゲートは tsc

oxlint は型情報を使わない（型認識リントは限定的）。`no-unsafe-*` 系の
型レベル保証は **`tsc --strict`**（`tsconfig.json`）が担う。oxlint は
構文・パターンレベル、tsc は型レベル、という二層構成。
