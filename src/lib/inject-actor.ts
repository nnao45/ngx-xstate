import { DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import {
  createActor,
  type Actor,
  type AnyActorLogic,
  type SnapshotFrom,
  type Subscription,
} from 'xstate';
import { getSchemas } from './schemas';
import { buildActorOptions, injectActorRef, validateAndSend } from './inject-actor-ref';
import type { InjectActorOptions, InjectActorReturn, SendEvent } from './types';
import { shallowEqual } from './shallow-equal';

export function injectActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: InjectActorOptions<TLogic>,
): InjectActorReturn<TLogic> {
  const schemas = getSchemas(logic);

  if (typeof options?.input !== 'function') {
    return buildStaticActor(logic, options, schemas);
  }

  return buildDynamicActor(logic, options, schemas);
}

function buildStaticActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options: InjectActorOptions<TLogic> | undefined,
  schemas: ReturnType<typeof getSchemas>,
): InjectActorReturn<TLogic> {
  const actorRef = injectActorRef(logic, options);

  const snapshotSig = signal<SnapshotFrom<TLogic>>(actorRef.getSnapshot(), { equal: shallowEqual });

  const sub = actorRef.subscribe((s) => {
    snapshotSig.set(s);
  });

  inject(DestroyRef).onDestroy(() => {
    sub.unsubscribe();
  });

  const send = (event: SendEvent<TLogic>): void => {
    validateAndSend(actorRef, event as Parameters<Actor<TLogic>['send']>[0], schemas);
  };

  return { snapshot: snapshotSig.asReadonly(), send, actorRef };
}

function buildDynamicActor<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options: InjectActorOptions<TLogic>,
  schemas: ReturnType<typeof getSchemas>,
): InjectActorReturn<TLogic> {
  const destroyRef = inject(DestroyRef);
  const inputFn = options.input as () => unknown;

  const initialInput = inputFn();
  let currentActor = createActor(logic, buildActorOptions(options, initialInput));

  const snapshotSig = signal<SnapshotFrom<TLogic>>(currentActor.getSnapshot(), {
    equal: shallowEqual,
  });

  let sub: Subscription = currentActor.subscribe((s) => {
    snapshotSig.set(s);
  });

  currentActor.start();

  destroyRef.onDestroy(() => {
    sub.unsubscribe();
    currentActor.stop();
  });

  effect(() => {
    const newInput = inputFn();

    untracked(() => {
      sub.unsubscribe();
      currentActor.stop();

      currentActor = createActor(logic, buildActorOptions(options, newInput));

      sub = currentActor.subscribe((s) => {
        snapshotSig.set(s);
      });

      currentActor.start();
    });
  });

  const send = (event: SendEvent<TLogic>): void => {
    validateAndSend(currentActor, event as Parameters<Actor<TLogic>['send']>[0], schemas);
  };

  return {
    snapshot: snapshotSig.asReadonly(),
    send,
    get actorRef(): Actor<TLogic> {
      return currentActor;
    },
  };
}
