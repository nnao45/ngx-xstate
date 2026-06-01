// ─── @zstate/core を再エクスポート（typedSetup / matchActor / renderStateTree など） ──
export * from '@zstate/core';

// ─── React アダプタ API ─────────────────────────────────────────────────────────
export { useActor } from './lib/use-actor';
export { useActorRef } from './lib/use-actor-ref';
export { useSelector } from './lib/use-selector';
export { createActorContext } from './lib/create-actor-context';
export { XStateDevtoolsProvider } from './lib/devtools';

export type { XStateDevtoolsProviderProps } from './lib/devtools';
export type { UseActorOptions, UseActorReturn, ActorContext } from './lib/types';
