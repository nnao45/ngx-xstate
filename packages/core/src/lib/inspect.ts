import {
  transition as xstateTransition,
  type AnyMachineSnapshot,
  type AnyStateMachine,
  type SnapshotFrom,
} from 'xstate';
import { allActiveStates, activeLeaves } from './compat/xstate-v5';
import { bfs, buildInternals, dfsAllPaths, findCycles, reachableFrom } from './inspect-graph';
import type { CommandInfo, ExtractTree, Inspector, TransitionInfo } from './inspect-types';

export type {
  Inspector,
  TransitionInfo,
  CommandInfo,
  InspectPath,
  PathsOf,
  AllEventsOf,
  EventsAtPath,
  ExtractTree,
  OrString,
} from './inspect-types';

// ─── Snapshot-aware helpers ───────────────────────────────────────────────────

function enabledTransitionsImpl(
  snapshot: AnyMachineSnapshot,
  edges: ReadonlyMap<string, TransitionInfo[]>,
): TransitionInfo[] {
  const active = allActiveStates(snapshot);
  const result: TransitionInfo[] = [];
  const seen = new Set<string>();
  for (const st of active) {
    for (const t of edges.get(st) ?? []) {
      // Deduplicate by id (captures guard/index granularity) rather than st::event
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (snapshot.can({ type: t.event } as Parameters<typeof snapshot.can>[0])) result.push(t);
    }
  }
  return result;
}

function blockedTransitionsImpl(
  snapshot: AnyMachineSnapshot,
  edges: ReadonlyMap<string, TransitionInfo[]>,
): TransitionInfo[] {
  const active = allActiveStates(snapshot);
  const result: TransitionInfo[] = [];
  const seen = new Set<string>();
  for (const st of active) {
    for (const t of edges.get(st) ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (!snapshot.can({ type: t.event } as Parameters<typeof snapshot.can>[0])) result.push(t);
    }
  }
  return result;
}

function explainBlockedImpl(
  snapshot: AnyMachineSnapshot,
  event: string,
  edges: ReadonlyMap<string, TransitionInfo[]>,
): string {
  const active = allActiveStates(snapshot);
  const hasDef = active.some((s) => (edges.get(s) ?? []).some((t) => t.event === event));
  if (!hasDef)
    return `No transition defined for event '${event}' in current state (${active.join(', ')})`;
  if (snapshot.can({ type: event } as Parameters<typeof snapshot.can>[0]))
    return `Event '${event}' is currently enabled`;
  const guards = active
    .flatMap((s) => edges.get(s) ?? [])
    .filter((t) => t.event === event && (t.guard !== undefined || t.guardLabel !== undefined));
  if (guards.length === 0) return `Event '${event}' is blocked (guard evaluation failed)`;
  const labels = guards.map((t) => t.guardLabel ?? t.guard ?? '(unknown)');
  return `Event '${event}' is blocked by guard${labels.length > 1 ? 's' : ''}: ${labels.join(', ')}`;
}

// ─── Main: inspect ───────────────────────────────────────────────────────────

/**
 * ステートマシンの静的・動的イントロスペクション API を返す。
 *
 * @example
 * const ins = inspect(authMachine);
 * ins.states()                         // ['loggedOut', 'loggedIn', 'loggedIn.active', ...]
 * ins.shortestPath('loggedOut', 'closed') // ['loggedOut', 'loggedIn', 'closed']
 * ins.canSend(snapshot, 'CHECKOUT')    // true | false（ガード評価込み）
 * ins.commands(snapshot)               // 有効遷移のアクション一覧
 */
export function inspect<TMachine extends AnyStateMachine>(
  machine: TMachine,
): Inspector<ExtractTree<TMachine>> {
  const { nodes, edges, initChild, allEvents, initialState } = buildInternals(machine);
  let cachedCycles: string[][] | undefined;
  const getCycles = (): string[][] => {
    cachedCycles ??= findCycles(nodes, edges, initChild);
    return cachedCycles;
  };
  const allTransitions = (): TransitionInfo[] => [...edges.values()].flat();

  type TState = ReturnType<Inspector<ExtractTree<TMachine>>['states']>[number];

  const impl: Inspector<ExtractTree<TMachine>> = {
    states: () => [...nodes.keys()] as TState[],
    events: () => [...allEvents] as ReturnType<typeof impl.events>,
    allowedEvents(state) {
      const result = new Set<string>();
      for (const t of allTransitions()) {
        if (t.source === state || (state as string).startsWith(`${t.source}.`)) result.add(t.event);
      }
      return [...result] as ReturnType<typeof impl.allowedEvents>;
    },
    transitionsFrom: (state) => edges.get(state as string) ?? [],
    targetsFrom: (state, event) =>
      (edges.get(state as string) ?? [])
        .filter((t) => t.event === (event as string))
        .map((t) => t.target)
        .filter((t): t is string => t !== undefined) as TState[],
    terminalStates: () =>
      [...nodes.entries()].filter(([, n]) => n.type === 'final').map(([k]) => k) as TState[],
    canReach: (state) => reachableFrom(initialState, edges, initChild).has(state as string),
    unreachableStates: () => {
      const reachable = reachableFrom(initialState, edges, initChild);
      return [...nodes.keys()].filter((s) => !reachable.has(s)) as TState[];
    },
    nonTerminalSinks: () =>
      [...nodes.entries()]
        .filter(([k, n]) => n.type !== 'final' && (edges.get(k) ?? []).length === 0)
        .map(([k]) => k) as TState[],
    cycles: () => getCycles() as TState[][],
    hasCycle: (state) => getCycles().some((c) => c.includes(state as string)),
    shortestPath: (from, to) =>
      bfs(from as string, to as string, edges, initChild) as TState[] | null,
    stateDistance: (from, to) => {
      const p = bfs(from as string, to as string, edges, initChild);
      return p === null ? -1 : p.length - 1;
    },
    allPaths: ({ maxDepth = 20 } = {}) =>
      dfsAllPaths(initialState, nodes, edges, initChild, maxDepth),
    canSend: (snapshot, event) =>
      snapshot.can({ type: event } as Parameters<typeof snapshot.can>[0]),
    nextStates: (snapshot, event) => {
      type SafeTrans = (
        l: TMachine,
        s: SnapshotFrom<TMachine>,
        e: { type: string },
      ) => [SnapshotFrom<TMachine>, unknown[]];
      const [next] = (xstateTransition as SafeTrans)(
        machine,
        snapshot as SnapshotFrom<TMachine>,
        event as unknown as { type: string },
      );
      return activeLeaves((next as unknown as { value: unknown }).value) as TState[];
    },
    enabledTransitions: (snapshot) => enabledTransitionsImpl(snapshot, edges),
    blockedTransitions: (snapshot) => blockedTransitionsImpl(snapshot, edges),
    explainBlocked: (snapshot, event) => explainBlockedImpl(snapshot, event as string, edges),
    commands: (snapshot): CommandInfo[] =>
      enabledTransitionsImpl(snapshot, edges).map((t) => ({
        event: t.event,
        source: t.source,
        target: t.target,
        actions: t.actions,
      })),
  };

  return impl;
}
