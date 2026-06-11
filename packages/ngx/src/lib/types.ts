import type { Actor, AnyActorLogic, SnapshotFrom } from 'xstate';
import type { InspectionEvent } from 'xstate';
import type { Signal, FactoryProvider } from '@angular/core';
import type { InputFrom, SendEvent, StateMatcherFor } from '@zstate/core';

export interface InjectActorOptions<TLogic extends AnyActorLogic> {
  /**
   * actor に渡す input 値。
   * - 静的値: `input: { userId: 'alice' }`
   * - Angular Signal / computed を読む factory 関数: `input: () => this.userId()`
   *   (関数の場合は Signal 変化を追跡し、変化のたびに actor を作り直す)
   *
   * 型は machine の `typedSetup({ input: z.object({...}) })` から自動推論される。
   */
  readonly input?: InputFrom<TLogic> | (() => InputFrom<TLogic>);
  readonly inspect?: (event: InspectionEvent) => void;
  readonly id?: string;
  readonly systemId?: string;
  readonly snapshot?: SnapshotFrom<TLogic>;
}

export interface InjectActorReturn<TLogic extends AnyActorLogic> {
  readonly snapshot: Signal<SnapshotFrom<TLogic>>;
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

export interface ActorContext<TLogic extends AnyActorLogic> {
  provideActor(options?: InjectActorOptions<TLogic>): FactoryProvider;
  injectActorRef(): Actor<TLogic>;
  injectSelector<T>(selector: (snapshot: SnapshotFrom<TLogic>) => T): Signal<T>;
}
