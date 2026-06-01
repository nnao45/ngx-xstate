import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { InspectionEvent } from 'xstate';
import type { XStateInspector } from '@zstate/core';

// bundler が置換する NODE_ENV。@types/node に依存しないよう最小宣言。
declare const process: { readonly env: { readonly NODE_ENV?: string } };

const InspectorContext = createContext<XStateInspector | undefined>(undefined);

export interface XStateDevtoolsProviderProps {
  readonly inspector: XStateInspector;
  readonly children: ReactNode;
}

/**
 * グローバルな XState inspector を Context で供給する。配下の useActor /
 * useActorRef / createActorContext で生成される全 actor が自動接続される。
 * 本番ビルド（NODE_ENV === 'production'）では no-op。
 *
 * @example
 * import { createBrowserInspector } from '@statelyai/inspect';
 *
 * <XStateDevtoolsProvider inspector={createBrowserInspector()}>
 *   <App />
 * </XStateDevtoolsProvider>
 */
export function XStateDevtoolsProvider(props: XStateDevtoolsProviderProps): ReactElement {
  const value = process.env.NODE_ENV === 'production' ? undefined : props.inspector;
  return <InspectorContext.Provider value={value}>{props.children}</InspectorContext.Provider>;
}

/** 内部用: 登録済みグローバル inspector の inspect 関数を取り出す（未登録なら undefined）。 */
export function useDevtoolsInspect(): ((event: InspectionEvent) => void) | undefined {
  const inspector = useContext(InspectorContext);
  return inspector ? inspector.inspect.bind(inspector) : undefined;
}
