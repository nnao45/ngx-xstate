import { DestroyRef, inject } from '@angular/core';
import { createActor, type Actor, type AnyActorLogic } from 'xstate';
import { getSchemas, type SchemasPayload } from './define-actor-with-schema';
import type { InjectActorOptions } from './types';

export function buildActorOptions<TLogic extends AnyActorLogic>(
  options: InjectActorOptions<TLogic> | undefined,
  input: unknown,
): Parameters<typeof createActor>[1] {
  return {
    id: options?.id,
    systemId: options?.systemId,
    inspect: options?.inspect,
    input: input as Parameters<typeof createActor>[1] extends { input?: infer I } ? I : never,
    snapshot: options?.snapshot as Parameters<typeof createActor>[1] extends { snapshot?: infer S } ? S : never,
  };
}

export function injectActorRef<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: InjectActorOptions<TLogic>,
): Actor<TLogic> {
  const destroyRef = inject(DestroyRef);
  const schemas = getSchemas(logic);

  const input = typeof options?.input === 'function'
    ? (options.input as () => unknown)()
    : options?.input;

  validateInput(input, schemas);

  const actor = createActor(logic, buildActorOptions(options, input));
  actor.start();
  destroyRef.onDestroy(() => { actor.stop(); });

  return actor;
}

function validateInput(input: unknown, schemas: SchemasPayload | undefined): void {
  if (schemas?.input == null || input == null) return;

  const result = schemas.input.safeParse(input);
  if (!result.success) {
    if (schemas.strict) {
      throw result.error;
    } else {
      console.warn('[ngx-xstate] Invalid input:', result.error.format());
    }
  }
}

export function validateAndSend<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
  event: Parameters<Actor<TLogic>['send']>[0],
  schemas: SchemasPayload | undefined,
): void {
  if (schemas?.events != null) {
    const result = schemas.events.safeParse(event);
    if (!result.success) {
      if (schemas.strict) {
        throw result.error;
      } else {
        console.warn('[ngx-xstate] Invalid event:', result.error.format());
        return;
      }
    }
  }
  actor.send(event);
}
