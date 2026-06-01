import { DestroyRef, inject } from '@angular/core';
import { createActor, type Actor, type AnyActorLogic, type InspectionEvent } from 'xstate';
import { getSchemas, type SchemasPayload } from '@zstate/core';
import { XSTATE_INSPECTOR } from './devtools';
import type { InjectActorOptions } from './types';

export function buildActorOptions<TLogic extends AnyActorLogic>(
  options: InjectActorOptions<TLogic> | undefined,
  input: unknown,
  globalInspect?: (event: InspectionEvent) => void,
): Parameters<typeof createActor>[1] {
  // Per-actor inspect takes precedence over global devtools inspector
  const inspect = options?.inspect ?? globalInspect;
  return {
    id: options?.id,
    systemId: options?.systemId,
    inspect,
    input: input as Parameters<typeof createActor>[1] extends { input?: infer I } ? I : never,
    snapshot: options?.snapshot as Parameters<typeof createActor>[1] extends { snapshot?: infer S }
      ? S
      : never,
  };
}

export function injectActorRef<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: InjectActorOptions<TLogic>,
): Actor<TLogic> {
  const destroyRef = inject(DestroyRef);
  const schemas = getSchemas(logic);
  // Pick up the global devtools inspector if registered via provideXstateDevtools()
  const globalInspector = inject(XSTATE_INSPECTOR, { optional: true });

  const input =
    typeof options?.input === 'function' ? (options.input as () => unknown)() : options?.input;

  validateInput(input, schemas);

  const actor = createActor(
    logic,
    buildActorOptions(options, input, globalInspector?.inspect.bind(globalInspector)),
  );
  actor.start();
  destroyRef.onDestroy(() => {
    actor.stop();
  });

  return actor;
}

function validateInput(input: unknown, schemas: SchemasPayload | undefined): void {
  if (schemas?.input == null || input == null) return;

  const result = schemas.input.safeParse(input);
  if (!result.success) {
    if (schemas.strict) {
      throw result.error;
    } else {
      console.warn('[@zstate/ngx] Invalid input:', result.error.format());
    }
  }
}
