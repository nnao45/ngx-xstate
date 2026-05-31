# `renderStateTree()`

## Purpose

machine または actor を受け取り、状態階層を **ASCII ツリー文字列**として返す純粋関数。
コンソール出力やログ、スナップショットテスト、ドキュメント生成に使う。

SVG 等のアプリ内描画は **見送り**（XState 本家も in-app 描画コンポーネントは提供せず、
可視化は外部ツールに寄せている。`provideXstateDevtools` が外部連携を担当）。
本関数は「アプリ内描画ほど重くないが、現在状態をサッと確認したい」軽量デバッグ用途。

---

## Signature

```typescript
function renderStateTree(input: AnyStateMachine | AnyActorRef): string;
```

- `machine` を渡す → **静的な構造ツリー**（現在マーカーなし）
- `actor` を渡す → **現在状態ハイライト付き**（今いる状態に `●`）

純粋関数。`console.log` はしない（呼び出し側が自由に出力）。

---

## Output format

```
auth ●
├─ loggedOut  (initial)
└─ loggedIn ●
   ├─ active ●  (initial)
   └─ idle
```

1 行 = 1 状態:
- **ツリー記号**: `├─ ` / `└─ `（最後の子）/ `│  ` / `   `（インデント継続）
- **状態名**: `node.key`
- **現在マーカー** ` ●`: actor を渡したとき、今アクティブな状態（ネスト・並列で複数可）
- **バッジ** `(...)`: 以下を `, ` 区切りで
  - `initial` — 親の `config.initial` がこの状態
  - `final` — `type === 'final'`
  - `parallel` — `type === 'parallel'`
  - `history` — `type === 'history'`

ルート行は machine id（`root.key`）。actor なら ` ●` が付く。並列ルートは `(parallel)`。

---

## Behavior

### machine vs actor の判別

```
typeof input.getSnapshot === 'function'  → actor
```

| | 構造取得 | 現在値 |
|---|---|---|
| machine | `input.root` | なし（マーカー無し） |
| actor | `input.logic.root` | `input.getSnapshot().value` |

### 現在状態の判定（StateValue マッチ）

`getSnapshot().value` は `string`（atomic）または入れ子 object（compound/parallel）。
各ノードの「親から見たサブ値」を再帰的に下ろしながら判定する:

- サブ値が `string` → その名前の子だけアクティブ
- サブ値が `object` → キーに含まれる子がアクティブ（並列は複数キー）
- アクティブな子へは対応するサブ値を、非アクティブな子へは `undefined` を渡す

machine 入力時はサブ値が常に `undefined` → マーカーは一切付かない。

---

## Usage

```typescript
import { renderStateTree } from 'ngx-xstate';

// 静的構造（設計確認・ドキュメント）
console.log(renderStateTree(authMachine));

// 現在状態付き（デバッグ）
const { actorRef } = injectActor(authMachine);
console.log(renderStateTree(actorRef));

// 別ロガー / スナップショットテスト
expect(renderStateTree(machine)).toMatchSnapshot();
```

---

## Design Decisions

| # | 決定 | 理由 |
|---|---|---|
| 描画方式 | コンソール文字列（SVG見送り） | SVGレイアウトが工数の9割。エコに価値の高い部分だけ取る |
| 戻り値 | `string` のみ（log版なし） | 純粋関数でテスト容易・別ロガー連携・スナップショット可 |
| 構造抽出 | `machine.root` 自前 walk | 依存ゼロ。`@xstate/graph` はテスト用途で過剰 |
| 情報量 | 名前+バッジ+現在マーカー | デバッグで欲しい「今どこ・どんな状態」を最小コストで |
| 遷移表示 | v1 では出さない | 横幅とエコさ優先。将来 `{ showTransitions: true }` で拡張余地 |

---

## Implementation Notes

- StateNode から使うのは `key` / `type` / `config.initial` / `states` のみ。
  これらを最小の構造型 `TreeNode` にキャストして型安全に walk する。
- `input.logic.root` / `input.root` へのアクセスは xstate 内部型との境界キャスト
  （`no-unsafe-type-assertion` は設定で許容済み。キャスト後は型付きで member access）。
