import { inject, InjectionToken, type FactoryProvider, type Signal } from '@angular/core';
import type { Actor, AnyActorLogic, SnapshotFrom } from 'xstate';
import { injectActorRef } from './inject-actor-ref';
import { injectSelector } from './inject-selector';
import type { ActorContext, InjectActorOptions } from './types';

export function createActorContext<TLogic extends AnyActorLogic>(
  logic: TLogic,
  defaultOptions?: InjectActorOptions<TLogic>,
): ActorContext<TLogic> {
  const token = new InjectionToken<Actor<TLogic>>('NgxXstateActor');

  const provideActor = (options?: InjectActorOptions<TLogic>): FactoryProvider => ({
    provide: token,
    useFactory: (): Actor<TLogic> => {
      const mergedOptions: InjectActorOptions<TLogic> = {
        ...defaultOptions,
        ...options,
      };
      return injectActorRef(logic, mergedOptions);
    },
  });

  const resolveActorRef = (): Actor<TLogic> => {
    const actor = inject(token, { optional: true });
    if (actor == null) {
      throw new Error(
        '[@zstate/ngx] injectActorRef() was called outside of a component ' +
          'that provides this actor. ' +
          "Make sure to add provideActor() to the component's providers array.",
      );
    }
    return actor;
  };

  const contextInjectActorRef = (): Actor<TLogic> => resolveActorRef();

  const contextInjectSelector = <T>(selector: (snapshot: SnapshotFrom<TLogic>) => T): Signal<T> => {
    const actor = resolveActorRef();
    return injectSelector(actor, selector);
  };

  return {
    provideActor,
    injectActorRef: contextInjectActorRef,
    injectSelector: contextInjectSelector,
  } satisfies ActorContext<TLogic>;
}
