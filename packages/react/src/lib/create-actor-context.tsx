import { createContext, useContext, type ReactElement } from 'react';
import type { Actor, AnyActorLogic, SnapshotFrom } from 'xstate';
import { useActorRef } from './use-actor-ref';
import { useSelector } from './use-selector';
import type { ActorContext, ActorContextProviderProps, UseActorOptions } from './types';

/**
 * 1 つの actor をコンポーネントサブツリーで共有する React Context を作る。
 * `@zstate/ngx` の `createActorContext`（DI 版）の React 版。
 *
 * @example
 * const CounterContext = createActorContext(counterMachine);
 *
 * <CounterContext.Provider>
 *   <Child />
 * </CounterContext.Provider>
 *
 * // Child 内:
 * const count = CounterContext.useSelector((s) => s.context.count);
 */
export function createActorContext<TLogic extends AnyActorLogic>(
  logic: TLogic,
  defaultOptions?: UseActorOptions<TLogic>,
): ActorContext<TLogic> {
  const Context = createContext<Actor<TLogic> | null>(null);

  function Provider(props: ActorContextProviderProps<TLogic>): ReactElement {
    const actorRef = useActorRef(props.logic ?? logic, { ...defaultOptions, ...props.options });
    return <Context.Provider value={actorRef}>{props.children}</Context.Provider>;
  }

  function useActorRefContext(): Actor<TLogic> {
    const actor = useContext(Context);
    if (actor === null) {
      throw new Error(
        '[@zstate/react] useActorRef() / useSelector() was called outside of the matching ' +
          "Provider. Wrap your component tree in this context's <Provider>.",
      );
    }
    return actor;
  }

  function useSelectorContext<T>(
    selector: (snapshot: SnapshotFrom<TLogic>) => T,
    compare?: (a: T, b: T) => boolean,
  ): T {
    const actor = useActorRefContext();
    return useSelector(actor, selector, compare);
  }

  return {
    Provider,
    useActorRef: useActorRefContext,
    useSelector: useSelectorContext,
  };
}
