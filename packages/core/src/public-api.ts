// ─── 公開 API（framework 非依存） ──────────────────────────────────────────────
export { typedSetup, noPayload } from './lib/typed-machine';
export { matchActor } from './lib/state-match';
export { renderStateTree } from './lib/render-state-tree';

export type { TypedMachineDef } from './lib/typed-machine';
export type { EventsMap, EventUnionFromMap } from './lib/typed-machine-types';
export type { Matcher, StateScope, StateMatcherFor } from './lib/state-match';
export type { XStateInspector } from './lib/devtools-types';
export type { SendEvent } from './lib/types';

// ─── アダプタ向けの共有 API（@zstate/ngx 等が利用する低レベル部品） ─────────────
export { validateAndSend } from './lib/validate';
export { shallowEqual } from './lib/shallow-equal';
export { attachSchemas, getSchemas, SCHEMAS_KEY } from './lib/schemas';
export { buildStateMatcher } from './lib/state-match';

export type { SchemasPayload } from './lib/schemas';
export type { StateTree, StateNodeShape, StateTreeOf, WithStateTree } from './lib/state-match';
