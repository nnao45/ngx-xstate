import { DestroyRef, inject, signal, type Signal } from '@angular/core';
import type { AnyActorRef, SnapshotFrom } from 'xstate';
import { shallowEqual } from './shallow-equal';

export function injectSelector<TActor extends Pick<AnyActorRef, 'subscribe' | 'getSnapshot'>, T>(
  actor: TActor,
  selector: (snapshot: SnapshotFrom<TActor>) => T,
): Signal<T> {
  const destroyRef = inject(DestroyRef);

  const selected = signal<T>(selector(actor.getSnapshot() as SnapshotFrom<TActor>), {
    equal: shallowEqual,
  });

  const subscription = actor.subscribe((snapshot) => {
    selected.set(selector(snapshot as SnapshotFrom<TActor>));
  });

  destroyRef.onDestroy(() => {
    subscription.unsubscribe();
  });

  return selected.asReadonly();
}
