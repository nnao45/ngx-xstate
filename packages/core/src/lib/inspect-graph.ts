import type { AnyStateMachine } from 'xstate';
import {
  getMachineRoot,
  getNodeTransitionMap,
  getInitialSnapshot,
  getSnapshotValue,
  getMachineGuardImplementations,
  guardName,
  resolveGuardLabel,
  actionName,
  activeLeaves,
  type V5StateNode,
} from './compat/xstate-v5';
import type { TransitionInfo, InspectPath } from './inspect-types';

export type { V5StateNode as RawNode };
export { activeLeaves, allActiveStates } from './compat/xstate-v5';

export interface NodeMeta {
  readonly path: string;
  readonly type: string;
}

export interface Internals {
  readonly nodes: ReadonlyMap<string, NodeMeta>;
  readonly edges: ReadonlyMap<string, TransitionInfo[]>;
  readonly initChild: ReadonlyMap<string, string>;
  readonly allEvents: ReadonlySet<string>;
  readonly initialState: string;
}

function dotJoin(prefix: string, key: string): string {
  return prefix.length > 0 ? `${prefix}.${key}` : key;
}

function buildEdgeList(
  src: string,
  node: V5StateNode,
  edgeList: TransitionInfo[],
  allEvents: Set<string>,
  guardImpls: Record<string, unknown>,
): void {
  for (const [et, defs] of getNodeTransitionMap(node)) {
    if (et === '*') continue;
    allEvents.add(et);
    defs.forEach((t, idx) => {
      const guard = guardName(t.guard);
      const gl = resolveGuardLabel(t.guard, guardImpls);
      const acts = (t.actions ?? []).map((a) => actionName(a));
      const id = `${src}::${et}::${idx}`;
      if (t.target !== undefined && t.target.length > 0) {
        for (const tgt of t.target) {
          edgeList.push({
            id,
            event: et,
            source: src,
            target: tgt.path.join('.'),
            index: idx,
            guard,
            guardLabel: gl,
            actions: acts,
          });
        }
      } else {
        edgeList.push({
          id,
          event: et,
          source: src,
          target: undefined,
          index: idx,
          guard,
          guardLabel: gl,
          actions: acts,
        });
      }
    });
  }
}

function walkGraph(
  node: V5StateNode,
  nodes: Map<string, NodeMeta>,
  edges: Map<string, TransitionInfo[]>,
  initChild: Map<string, string>,
  allEvents: Set<string>,
  guardImpls: Record<string, unknown>,
): void {
  const dotPath = node.path.join('.');
  if (node.path.length > 0) {
    nodes.set(dotPath, { path: dotPath, type: node.type });
    edges.set(dotPath, []);
    if (node.type === 'compound' && typeof node.config.initial === 'string') {
      initChild.set(dotPath, dotJoin(dotPath, node.config.initial));
    }
  }
  if (dotPath.length > 0) {
    const edgeList = edges.get(dotPath);
    if (edgeList !== undefined) buildEdgeList(dotPath, node, edgeList, allEvents, guardImpls);
  }
  for (const child of Object.values(node.states)) {
    walkGraph(child, nodes, edges, initChild, allEvents, guardImpls);
  }
}

export function buildInternals(machine: AnyStateMachine): Internals {
  const nodes = new Map<string, NodeMeta>();
  const edges = new Map<string, TransitionInfo[]>();
  const initChild = new Map<string, string>();
  const allEvents = new Set<string>();
  const guardImpls = getMachineGuardImplementations(machine);

  walkGraph(getMachineRoot(machine), nodes, edges, initChild, allEvents, guardImpls);

  const initSnap = getInitialSnapshot(machine);
  const initialState = activeLeaves(getSnapshotValue(initSnap))[0] ?? '';

  return { nodes, edges, initChild, allEvents, initialState };
}

export function expandInitChain(state: string, initChild: ReadonlyMap<string, string>): string[] {
  const result: string[] = [state];
  let cur = state;
  for (;;) {
    const next = initChild.get(cur);
    if (next === undefined) break;
    cur = next;
    result.push(cur);
  }
  return result;
}

function reconstructPath(prev: Map<string, string>, from: string, to: string): string[] {
  const path: string[] = [to];
  let node: string = to;
  while (node !== from) {
    const p = prev.get(node);
    if (p === undefined) break;
    node = p;
    path.unshift(node);
  }
  return path;
}

/** BFS: from → to への最短経路（状態列）を返す。到達不能なら null */
export function bfs(
  from: string,
  to: string,
  edges: ReadonlyMap<string, TransitionInfo[]>,
  initChild: ReadonlyMap<string, string>,
): string[] | null {
  const startStates = expandInitChain(from, initChild);
  if (startStates.includes(to)) return [from, ...startStates.slice(1, startStates.indexOf(to) + 1)];

  const prev = new Map<string, string>();
  for (const s of startStates) if (s !== from) prev.set(s, from);
  const queue: string[] = [...startStates];
  const visited = new Set<string>(startStates);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    for (const t of edges.get(cur) ?? []) {
      if (t.target === undefined) continue;
      for (const next of expandInitChain(t.target, initChild)) {
        if (visited.has(next)) continue;
        prev.set(next, cur);
        if (next === to) return reconstructPath(prev, from, to);
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return null;
}

/** BFS による到達可能集合（initChild 展開込み） */
export function reachableFrom(
  start: string,
  edges: ReadonlyMap<string, TransitionInfo[]>,
  initChild: ReadonlyMap<string, string>,
): Set<string> {
  const initStates = expandInitChain(start, initChild);
  const visited = new Set<string>(initStates);
  const queue: string[] = [...initStates];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    for (const t of edges.get(cur) ?? []) {
      if (t.target === undefined) continue;
      for (const s of expandInitChain(t.target, initChild)) {
        if (!visited.has(s)) {
          visited.add(s);
          queue.push(s);
        }
      }
    }
  }
  return visited;
}

/** Tarjan SCC → サイクルを構成する SCC（2ノード以上 or 自己ループ）を返す */
export function findCycles(
  nodes: ReadonlyMap<string, NodeMeta>,
  edges: ReadonlyMap<string, TransitionInfo[]>,
  initChild: ReadonlyMap<string, string>,
): string[][] {
  let counter = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  function sc(v: string): void {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const t of edges.get(v) ?? []) {
      if (t.target === undefined) continue;
      for (const w of expandInitChain(t.target, initChild)) {
        if (!idx.has(w)) {
          sc(w);
          low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v) ?? 0, idx.get(w) ?? 0));
        }
      }
    }
    if (low.get(v) === idx.get(v)) {
      const scc: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      const first = scc[0];
      if (
        scc.length > 1 ||
        (scc.length === 1 &&
          first !== undefined &&
          (edges.get(first) ?? []).some((t) => t.target === first))
      ) {
        result.push(scc);
      }
    }
  }

  for (const v of nodes.keys()) if (!idx.has(v)) sc(v);
  return result;
}

/** DFS による全経路（初期状態 → 終端または maxDepth） */
export function dfsAllPaths(
  start: string,
  nodes: ReadonlyMap<string, NodeMeta>,
  edges: ReadonlyMap<string, TransitionInfo[]>,
  initChild: ReadonlyMap<string, string>,
  maxDepth: number,
): InspectPath[] {
  const result: InspectPath[] = [];
  function dfs(cur: string, stPath: string[], evPath: string[], visited: Set<string>): void {
    const node = nodes.get(cur);
    const outs = edges.get(cur) ?? [];
    if (outs.length === 0 || node?.type === 'final' || evPath.length >= maxDepth) {
      result.push({ states: [...stPath], events: [...evPath] });
      return;
    }
    const seen = new Set<string>();
    for (const t of outs) {
      if (t.target === undefined) continue;
      const chain = expandInitChain(t.target, initChild);
      const leaf = chain[chain.length - 1] ?? t.target;
      const key = `${t.event}:${leaf}`;
      if (seen.has(key) || visited.has(leaf)) continue;
      seen.add(key);
      visited.add(leaf);
      dfs(leaf, [...stPath, leaf], [...evPath, t.event], visited);
      visited.delete(leaf);
    }
  }
  dfs(start, [start], [], new Set([start]));
  return result;
}
