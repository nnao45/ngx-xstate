import type { Actor, AnyActorLogic, SnapshotFrom } from 'xstate';
import type { InspectionEvent } from 'xstate';
import type { Signal, FactoryProvider } from '@angular/core';
import type { StateMatcherFor } from './state-match';

/**
 * send が受け付けるイベント型。typedSetup が生成する machine は
 * setup で完全に型付けされているため、machine 自身の send パラメータ型を使う。
 */
export type SendEvent<TLogic extends AnyActorLogic> = Parameters<Actor<TLogic>['send']>[0];

export interface InjectActorOptions<TLogic extends AnyActorLogic> {
  readonly input?: Parameters<Actor<TLogic>['send']> extends never ? never : unknown;
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
