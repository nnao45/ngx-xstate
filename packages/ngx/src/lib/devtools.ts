import {
  isDevMode,
  InjectionToken,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from '@angular/core';
import type { XStateInspector } from '@zstate/core';

export const XSTATE_INSPECTOR = new InjectionToken<XStateInspector>('NgxXstateInspector');

/**
 * Registers a global XState inspector that is automatically connected to
 * every actor created via injectActor(), injectActorRef(), and createActorContext().
 *
 * No-ops in production (isDevMode() === false) even if called.
 *
 * @example
 * // app.config.ts
 * import { createBrowserInspector } from '@statelyai/inspect';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideXstateDevtools(createBrowserInspector()),
 *   ],
 * };
 */
export function provideXstateDevtools(inspector: XStateInspector): EnvironmentProviders {
  if (!isDevMode()) {
    return makeEnvironmentProviders([]);
  }

  return makeEnvironmentProviders([{ provide: XSTATE_INSPECTOR, useValue: inspector }]);
}
