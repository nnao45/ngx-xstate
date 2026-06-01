import { useCallback } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector.js';
import type { AnyActorRef, SnapshotFrom } from 'xstate';
import { shallowEqual } from '@zstate/core';

/**
 * actor のスナップショットから派生値をメモ化購読する。デフォルトの比較は
 * `shallowEqual` なので、選択したスライスが実際に変わった時だけ再レンダーする。
 * `@zstate/ngx` の `injectSelector` の React 版。
 */
export function useSelector<TActor extends Pick<AnyActorRef, 'subscribe' | 'getSnapshot'>, T>(
  actor: TActor,
  selector: (snapshot: SnapshotFrom<TActor>) => T,
  compare: (a: T, b: T) => boolean = shallowEqual,
): T {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const sub = actor.subscribe(onStoreChange);
      return () => {
        sub.unsubscribe();
      };
    },
    [actor],
  );

  const getSnapshot = useCallback(() => actor.getSnapshot() as SnapshotFrom<TActor>, [actor]);

  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, selector, compare);
}
