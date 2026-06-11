import type { Actor, AnyActorLogic, InspectionEvent, SnapshotFrom } from 'xstate';
import type { ReactElement, ReactNode } from 'react';
import type { InputFrom, SendEvent, StateMatcherFor } from '@zstate/core';

export interface UseActorOptions<TLogic extends AnyActorLogic> {
  /**
   * actor に渡す input 値。
   * 型は machine の `typedSetup({ input: z.object({...}) })` から自動推論される。
   */
  readonly input?: InputFrom<TLogic>;
  readonly inspect?: (event: InspectionEvent) => void;
  readonly id?: string;
  readonly systemId?: string;
  readonly snapshot?: SnapshotFrom<TLogic>;
}

export interface UseActorReturn<TLogic extends AnyActorLogic> {
  /** 現在のスナップショット（遷移ごとに再レンダーされる値） */
  readonly snapshot: SnapshotFrom<TLogic>;
  readonly send: (event: SendEvent<TLogic>) => void;
  readonly actorRef: Actor<TLogic>;
  /**
   * 現在状態に対する型安全な case/when マッチャ（一発読み）。
   * `actor.in('idle', idle => idle.send(...))` のように使う。
   */
  readonly in: StateMatcherFor<TLogic>['in'];
  /**
   * 複合状態の子へ潜るスコープ付きマッチャ（一発読み）。
   * `actor.within('loggedIn', s => s.in('active', a => a.send(...)))` のように使う。
   */
  readonly within: StateMatcherFor<TLogic>['within'];
}

export interface ActorContextProviderProps<TLogic extends AnyActorLogic> {
  readonly children: ReactNode;
  readonly options?: UseActorOptions<TLogic>;
  readonly logic?: TLogic;
}

export interface ActorContext<TLogic extends AnyActorLogic> {
  Provider: (props: ActorContextProviderProps<TLogic>) => ReactElement;
  useActorRef(): Actor<TLogic>;
  useSelector<T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
    compare?: (a: T, b: T) => boolean,
  ): T;
}
