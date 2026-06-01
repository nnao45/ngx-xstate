import type { InspectionEvent } from 'xstate';

/**
 * XState の inspector インターフェース（framework 非依存の型のみ）。
 * Angular の DI トークン / provider は `@zstate/ngx` 側が提供する。
 */
export interface XStateInspector {
  inspect: (event: InspectionEvent) => void;
}
