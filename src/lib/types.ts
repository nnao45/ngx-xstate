import type { Actor, AnyActorLogic, SnapshotFrom } from 'xstate';
import type { InspectionEvent } from 'xstate';
import type { z } from 'zod';
import type { Signal, FactoryProvider } from '@angular/core';
import type { SCHEMAS_KEY } from './define-actor-with-schema';

export type SchematizedActor<
  TLogic extends AnyActorLogic,
  TCtx extends z.ZodTypeAny,
  TEvents extends z.ZodTypeAny,
  TInput extends z.ZodTypeAny,
> = TLogic & {
  readonly [SCHEMAS_KEY]: {
    readonly context: TCtx | undefined;
    readonly events: TEvents | undefined;
    readonly input: TInput | undefined;
    readonly strict: boolean;
  };
};

export type AnySchematizedActor = SchematizedActor<
  AnyActorLogic,
  z.ZodTypeAny,
  z.ZodTypeAny,
  z.ZodTypeAny
>;

export type SendEvent<TLogic extends AnyActorLogic> =
  TLogic extends SchematizedActor<AnyActorLogic, z.ZodTypeAny, infer TEvents, z.ZodTypeAny>
    ? z.infer<TEvents>
    : Parameters<Actor<TLogic>['send']>[0];

export interface InjectActorOptions<TLogic extends AnyActorLogic> {
  readonly input?: Parameters<Actor<TLogic>['send']> extends never
    ? never
    : unknown;
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
  injectSelector<T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
  ): Signal<T>;
}
