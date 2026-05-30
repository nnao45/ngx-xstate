# `provideXstateDevtools()`

## Purpose

グローバルな XState inspector を Angular DI に登録し、以降 `injectActor` / `injectActorRef` / `createActorContext` で作られる**全 actor を自動でインスペクターに接続**する。Stately Visualizer や任意のロガーへ繋げる。

`@xstate/react` には無い、ngx-xstate 独自の機能。

---

## Signature

```typescript
function provideXstateDevtools(inspector: XStateInspector): EnvironmentProviders;

interface XStateInspector {
  inspect: (event: InspectionEvent) => void;
}
```

`InspectionEvent` は XState v5 が発行する `@xstate.actor` / `@xstate.snapshot` / `@xstate.event` などのイベント。

---

## Behavior

### 1. グローバル自動接続

`app.config.ts` で一度登録すれば、それ以降に注入される全 actor の `inspect` に自動で接続される。actor ごとに `inspect` を渡す必要がない。

```
provideXstateDevtools(inspector)
    │  InjectionToken<XStateInspector> として登録
    ▼
injectActorRef() / injectActor() / provideActor()
    │  inject(XSTATE_INSPECTOR, { optional: true }) で取得
    ▼
createActor(logic, { inspect: inspector.inspect })
```

### 2. 本番では no-op

`isDevMode()` が `false`（本番ビルド）のとき、`provideXstateDevtools()` は**空の provider を返す**。本番バンドルに残っても inspector は一切繋がらず、オーバーヘッドゼロ。

```typescript
export function provideXstateDevtools(inspector: XStateInspector): EnvironmentProviders {
  if (!isDevMode()) {
    return makeEnvironmentProviders([]); // 何も登録しない
  }
  return makeEnvironmentProviders([
    { provide: XSTATE_INSPECTOR, useValue: inspector },
  ]);
}
```

### 3. per-actor の inspect が優先

特定の actor だけ別の inspector を使いたい場合、`injectActor(machine, { inspect })` の per-actor 指定がグローバルより優先される。

```typescript
// グローバル inspector は無視され、こちらが使われる
injectActor(machine, { inspect: (e) => myCustomLogger(e) });
```

---

## Usage

### Stately Visualizer に繋ぐ

```typescript
// app.config.ts
import { ApplicationConfig } from '@angular/core';
import { createBrowserInspector } from '@statelyai/inspect';
import { provideXstateDevtools } from 'ngx-xstate';

export const appConfig: ApplicationConfig = {
  providers: [
    provideXstateDevtools(createBrowserInspector()),
    // createBrowserInspector() は https://stately.ai/inspect を開く
  ],
};
```

これだけで、アプリ内の全 machine の状態遷移が Stately Visualizer にリアルタイムで可視化される。

### カスタムロガーに繋ぐ

```typescript
provideXstateDevtools({
  inspect: (event) => {
    if (event.type === '@xstate.snapshot') {
      console.log('[XState]', event.actorRef.id, event.snapshot);
    }
  },
});
```

### コンポーネントスコープに限定

`EnvironmentProviders` なので、ルート（`app.config.ts`）だけでなく、ルートレベルの `providers` にも置ける。

---

## Design Decisions

| # | 決定 | 理由 |
|---|---|---|
| backend | `{ inspect }` 最小インターフェース | `@statelyai/inspect` を peer dep にせず、カスタムロガーも両対応 |
| 接続方式 | `InjectionToken` 経由の自動接続 | グローバル変数より DI でテストしやすく、スコープも効く |
| dev制限 | `isDevMode()` で本番 no-op | 本番に残っても安全。ユーザーが環境出し分けを意識しなくていい |
| context統合 | `createActorContext` にも自動で流れる | 「一度設定したら全部繋がる」が devtools の価値 |
| 優先順位 | per-actor `inspect` > global | 特定 actor だけ別ロガーに繋ぐ余地を残す |

---

## Notes

- `@statelyai/inspect` は **peer dependency ではない**。ユーザーが必要なときに自分でインストールする（`npm i -D @statelyai/inspect`）。
- ngx-xstate 本体は `InspectionEvent` 型（xstate 由来）にしか依存しない。
