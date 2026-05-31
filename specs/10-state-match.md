# 状態スコープ付き型安全イベント送信（`matchActor` / `injectActor().in`）

## Purpose

現在の状態を `case/when` 風にマッチし、**その状態で有効なイベントだけ**を型安全に送れる
モナディックAPI。

```ts
actor
  .in('idle').tap(idle => {
    idle.send({ type: 'FETCH' });   // OK
    idle.send({ type: 'RESOLVE' }); // ❌ コンパイルエラー（idle に RESOLVE 遷移なし）
  })
  .in('loading').tap(loading => loading.send({ type: 'CANCEL' }))
  .otherwise(() => {/* どの状態でもない */});
```

---

## なぜブランドが要るか

XState の machine 型は `config.states.X.on` を**型として保持しない**（`createMachine` 後に
widening される）。そのため「状態Xで有効なイベント」を素の machine 型からは導出できない。

`typedSetup().createMachine(config)` が **config リテラルを `const` 捕捉**し、状態ツリー
（各状態の `on` キー + 子状態）を `StateTree` として machine 型に phantom ブランドで付与する。
`matchActor` / `.in()` はこのブランドを読んで per-state イベントを絞り込む。

---

## API

### `actor.in(name)`（injectActor 戻り値）

```ts
const actor = injectActor(machine);
actor.in('idle').tap(idle => idle.send({ type: 'FETCH' }));
```

`.in()` 呼び出し時点の `getSnapshot()` を**一発読み**する（命令的）。リアクティブに
したい場合は `effect(() => actor.in(...))` で包む。`scope.send` は injectActor の
**検証付き send**（Zod ランタイム検証）を使う。

### `matchActor(actorRef)`（スタンドアロン）

`injectActorRef` や `createActorContext` の actorRef にも使える。

```ts
import { matchActor } from 'ngx-xstate';
matchActor(actorRef).in('idle').tap(idle => idle.send({ type: 'FETCH' }));
```

---

## チェーン構造

| メソッド | 対象 | 返り値 | 意味 |
|---|---|---|---|
| `Matcher.in(name)` | この階層の状態を選ぶ | `Branch` | 状態を選択 |
| `Branch.tap(cb)` | 一致時に cb 実行 | `Matcher`（親レベル＝兄弟へ） | case 節。一致した時だけ実行 |
| `Branch.in(child)` | 子状態へ潜る | `Branch` | ネスト降下 |
| `Matcher.otherwise(cb)` | どの `.in` にも未一致時 | `void` | default 節 |

```ts
// 兄弟（case/when）: .tap が Matcher に戻る
actor.in('idle').tap(...).in('loading').tap(...);

// ネスト: .in().in() で潜る
actor.in('loggedIn').in('active').tap(active => active.send({ type: 'GO_IDLE' }));
```

トップレベルで同時にアクティブな状態は1つ（非並列）なので、`.tap` が実行されるのは
最大1分岐 = 真の case/when。

---

## スコープ（`.tap(scope => ...)`）

```ts
interface StateScope {
  send(event): void;   // その状態で有効なイベントだけ（machine 全 union を on キーで Extract）
  context;             // 現在の context（readonly）
  value;               // 一致した状態名（リテラル）
}
```

```ts
actor.in('loading').tap(loading => {
  if (loading.context.retries < 3) loading.send({ type: 'RETRY' });
  console.log(loading.value); // 'loading'
});
```

---

## ランタイム判定

`StateValue`（`string` または入れ子 object）を path（状態名配列）でたどって一致判定:

- path `[idle]` → `value === 'idle'`（atomic）または `'idle' in value`
- path `[loggedIn, active]` → `value.loggedIn === 'active'` 等

`.otherwise` は、その chain で**どの `.in` も一致しなかった**ときだけ実行（共有フラグで追跡）。

---

## Scope（v1）

- トップレベル状態 + `.in().in()` での子状態降下に対応
- 並列領域の同時マッチは `.in()` で各領域名を辿れる（value が object なら複数キー）
- 素の `createMachine`（ブランド無し）machine は `.in()` の状態名が `never` に縮退
  （typedSetup 製のみ per-state 絞り込みが効く）

---

## Design Decisions

| # | 決定 | 理由 |
|---|---|---|
| 形 | Option 的 Matcher/Branch チェーン | ユーザー例 `.in().tap()` に合致、副作用を構造化 |
| 終端 | `.tap` + `.otherwise`（値生成 `.match` は将来） | case/when の自然な使い方。網羅強制は副作用チェーンと相性が悪い |
| 生え場所 | injectActor 戻り値 `.in` + スタンドアロン `matchActor` | 主用途と、ref/context 経由の両対応 |
| 評価 | 一発読み（現在 snapshot） | 送信は基本ユーザー操作起点。reactive は effect で包める |
| ネスト | `.in().in()` 降下、`.tap().in()` 兄弟 | ドットパスより自然 |
| 構造抽出 | createMachine で config を const 捕捉しブランド | 素の machine 型は on キーを保持しないため |
