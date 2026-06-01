import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Actor, AnyActorLogic } from 'xstate';
import {
  buildStateMatcher,
  getSchemas,
  validateAndSend,
  type SendEvent,
  type StateMatcherFor,
} from '@zstate/core';
import { useActorRef } from './use-actor-ref';
import type { UseActorOptions, UseActorReturn } from './types';

/**
 * machine から actor を生成・購読し、スナップショット・型付き send・状態スコープ
 * マッチャ（`.in` / `.within`）を返す。`@zstate/ngx` の `injectActor` の React 版。
 *
 * - `snapshot` は値（`useSyncExternalStore`、遷移ごとに再レンダー）
 * - `send` は Zod スキーマでランタイム検証してから送る
 * - `.in` / `.within` は呼び出し時の現在状態を読む一発読み matcher
 */
export function useActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: UseActorOptions<TLogic>,
): UseActorReturn<TLogic> {
  const actorRef = useActorRef(logic, options);
  const schemas = useMemo(() => getSchemas(logic), [logic]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const sub = actorRef.subscribe(onStoreChange);
      return () => {
        sub.unsubscribe();
      };
    },
    [actorRef],
  );
  const getSnapshot = useCallback(() => actorRef.getSnapshot(), [actorRef]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const send = useCallback(
    (event: SendEvent<TLogic>): void => {
      validateAndSend(actorRef, event as Parameters<Actor<TLogic>['send']>[0], schemas);
    },
    [actorRef, schemas],
  );

  const matcher = useCallback((): StateMatcherFor<TLogic> => {
    const snap = actorRef.getSnapshot() as { value: never; context: unknown };
    return buildStateMatcher(
      snap.value,
      send as (e: { type: string }) => void,
      snap.context,
    ) as never;
  }, [actorRef, send]);

  const inFn = useMemo<StateMatcherFor<TLogic>['in']>(
    () => ((name: never, cb: never) => matcher().in(name, cb)) as never,
    [matcher],
  );
  const withinFn = useMemo<StateMatcherFor<TLogic>['within']>(
    () => ((name: never, cb: never) => matcher().within(name, cb)) as never,
    [matcher],
  );

  return { snapshot, send, actorRef, in: inFn, within: withinFn };
}
