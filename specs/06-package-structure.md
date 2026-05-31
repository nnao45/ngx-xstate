# Package Structure

## Overview

ng-packagr を使った単一 Angular ライブラリ。NX モノレポなし。

---

## Directory Layout

```
ngx-xstate/
├── specs/                         ← 設計仕様書（このディレクトリ）
├── src/
│   ├── lib/
│   │   ├── typed-machine.ts             ← createTypedMachine（二段階API）
│   │   ├── typed-machine-types.ts       ← EventsMap / EventUnionFromMap
│   │   ├── schemas.ts                   ← attachSchemas / getSchemas（ランタイムスキーマ）
│   │   ├── devtools.ts                  ← provideXstateDevtools
│   │   ├── inject-actor.ts               ← injectActor
│   │   ├── inject-actor-ref.ts           ← injectActorRef
│   │   ├── inject-selector.ts            ← injectSelector + shallowEqual
│   │   ├── create-actor-context.ts       ← createActorContext
│   │   └── types.ts                      ← 共有型定義
│   └── public-api.ts                     ← エクスポート一覧
├── ng-package.json                ← ng-packagr 設定
├── package.json
├── tsconfig.json
├── tsconfig.lib.json
└── tsconfig.spec.json
```

---

## `package.json`

```json
{
  "name": "ngx-xstate",
  "version": "0.1.0",
  "description": "Angular bindings for XState v5 with Zod schema integration",
  "keywords": ["angular", "xstate", "state-machine", "signals", "zod"],
  "license": "MIT",
  "peerDependencies": {
    "@angular/core": ">=20.0.0",
    "xstate": ">=5.0.0",
    "zod": ">=3.0.0"
  },
  "devDependencies": {
    "@angular/core": "^20.0.0",
    "@angular/compiler": "^20.0.0",
    "@angular/compiler-cli": "^20.0.0",
    "ng-packagr": "^20.0.0",
    "typescript": "~5.6.0",
    "xstate": "^5.32.0",
    "zod": "^3.24.0"
  }
}
```

---

## `ng-package.json`

```json
{
  "$schema": "./node_modules/ng-packagr/ng-package.schema.json",
  "lib": {
    "entryFile": "src/public-api.ts"
  }
}
```

---

## `public-api.ts`

```typescript
export { createTypedMachine } from './lib/typed-machine';
export { injectActor } from './lib/inject-actor';
export { injectActorRef } from './lib/inject-actor-ref';
export { injectSelector } from './lib/inject-selector';
export { createActorContext } from './lib/create-actor-context';

// Types
export type {
  SchematizedActor,
  InjectActorOptions,
  InjectActorReturn,
  ActorContext,
} from './lib/types';
```

---

## `tsconfig.json`

```json
{
  "compileOnSave": false,
  "compilerOptions": {
    "baseUrl": "./",
    "declaration": false,
    "downlevelIteration": true,
    "experimentalDecorators": true,
    "moduleResolution": "bundler",
    "module": "ES2022",
    "target": "ES2022",
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  }
}
```

## `tsconfig.lib.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "inlineSources": true,
    "outDir": "../../out-tsc/lib",
    "types": []
  },
  "exclude": ["**/*.spec.ts"]
}
```

---

## Build

```bash
npm run build    # ng-packagr でビルド → dist/ngx-xstate/
npm publish      # dist/ から publish
```

---

## Peer Dependency Versions Rationale

| Dep | Version | Reason |
|---|---|---|
| `@angular/core` | `>=19` | `linkedSignal` stable, `input()`/`output()` stable, `DestroyRef` stable |
| `xstate` | `>=5.0.0` | v5 API (`createActor`, `AnyActorLogic`, etc.) |
| `zod` | `>=3.0.0` | `z.discriminatedUnion`, `z.infer` |

---

## Build Output Structure (ng-packagr)

```
dist/ngx-xstate/
├── esm2022/              ← ESM (tree-shakable)
│   └── ngx-xstate.mjs
├── fesm2022/             ← flat ESM
│   └── ngx-xstate.mjs
├── index.d.ts
├── package.json
└── README.md
```
