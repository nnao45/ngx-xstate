import type { Actor, AnyActorLogic, SnapshotFrom } from 'xstate';
import type { InspectionEvent } from 'xstate';
import type { Signal, FactoryProvider } from '@angular/core';

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
}

export interface ActorContext<TLogic extends AnyActorLogic> {
  provideActor(options?: InjectActorOptions<TLogic>): FactoryProvider;
  injectActorRef(): Actor<TLogic>;
  injectSelector<T>(selector: (snapshot: SnapshotFrom<TLogic>) => T): Signal<T>;
}
