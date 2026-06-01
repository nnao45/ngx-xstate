// ─── @zstate/core を再エクスポート（typedSetup / matchActor / renderStateTree など） ──
// `@zstate/ngx` 単体で core の API も使えるよう、まとめて公開する。
export * from '@zstate/core';

// ─── Angular アダプタ API ───────────────────────────────────────────────────────
export { provideXstateDevtools } from './lib/devtools';
export { injectActor } from './lib/inject-actor';
export { injectActorRef } from './lib/inject-actor-ref';
export { injectSelector } from './lib/inject-selector';
export { createActorContext } from './lib/create-actor-context';

export type { InjectActorOptions, InjectActorReturn, ActorContext } from './lib/types';
