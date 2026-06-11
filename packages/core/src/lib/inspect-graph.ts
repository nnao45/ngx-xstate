import { createActor, type AnyMachineSnapshot, type AnyStateMachine } from 'xstate';
import type { TransitionInfo, InspectPath } from './inspect-types';

export interface RawNode {
  readonly key: string;
  readonly type: string;
  readonly path: readonly string[];
  readonly states: Record<string, RawNode>;
  readonly config: { readonly initial?: unknown };
}

interface RawTrans {
  readonly target: Array<{ readonly path: readonly string[] }> | undefined;
  readonly eventType: string;
  readonly guard?: unknown;
}

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

function getRoot(machine: AnyStateMachine): RawNode {
  return (machine as unknown as { root: RawNode }).root;
}

function rawTransitions(node: RawNode): RawTrans[] {
  const map = (node as unknown as { transitions?: Map<string, RawTrans[]> }).transitions;
  if (map === undefined) return [];
  const out: RawTrans[] = [];
  for (const [et, defs] of map) if (et !== '*') for (const d of defs) out.push(d);
  return out;
}

export function guardName(guard: unknown): string | undefined {
  if (guard == null) return undefined;
  if (typeof guard === 'string') return guard;
  if (typeof guard === 'function') {
    const n = (guard as { name?: string }).name;
    return n != null && n !== 'guard' ? n : '(fn)';
  }
  if (typeof guard === 'object') {
    const t = (guard as Record<string, unknown>)['type'];
    if (typeof t === 'string') return t;
  }
  return '(unknown)';
}

function joinPath(prefix: string, key: string): string { return prefix.length > 0 ? `${prefix}.${key}` : key; }
function snapshotValue(snapshot: AnyMachineSnapshot): unknown { return (snapshot as unknown as { value: unknown }).value; }

export function activeLeaves(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [joinPath(prefix, value)];
  if (typeof value === 'object' && value !== null) {
    const r: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) r.push(...activeLeaves(v, joinPath(prefix, k)));
    return r;
  }
  return prefix.length > 0 ? [prefix] : [];
}

/** snapshot.value から全アクティブ状態（複合 + リーフ）を収集 */
export function allActiveStates(snapshot: AnyMachineSnapshot): string[] {
  function collect(value: unknown, prefix: string): string[] {
    if (typeof value === 'string') return [joinPath(prefix, value)];
    if (typeof value === 'object' && value !== null) {
      const result: string[] = [];
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const path = joinPath(prefix, k);
        result.push(path, ...collect(v, path));
      }
      return result;
    }
    return prefix.length > 0 ? [prefix] : [];
  }
  return collect(snapshotValue(snapshot), '');
}

export function buildInternals(machine: AnyStateMachine): Internals {
  const nodes = new Map<string, NodeMeta>();
  const edges = new Map<string, TransitionInfo[]>();
  const initChild = new Map<string, string>();
  const allEvents = new Set<string>();

  function walk(node: RawNode): void {
    const path = node.path.join('.');
    if (node.path.length > 0) {
      nodes.set(path, { path, type: node.type });
      edges.set(path, []);
      if (node.type === 'compound' && typeof node.config.initial === 'string') {
        initChild.set(path, joinPath(path, node.config.initial));
      }
    }

    const src = path;
    if (src.length > 0) {
      for (const t of rawTransitions(node)) {
        allEvents.add(t.eventType);
        const guard = guardName(t.guard);
        const edgeList = edges.get(src);
        if (edgeList === undefined) continue;
        if (t.target !== undefined && t.target.length > 0) {
          for (const tgt of t.target) {
            edgeList.push({ event: t.eventType, source: src, target: tgt.path.join('.'), guard });
          }
        } else {
          edgeList.push({ event: t.eventType, source: src, target: undefined, guard });
        }
      }
    }

    for (const child of Object.values(node.states)) {
      walk(child);
    }
  }

  walk(getRoot(machine));

  const initSnap = createActor(machine).getSnapshot() as AnyMachineSnapshot;
  const initialState = activeLeaves(snapshotValue(initSnap))[0] ?? '';

  return { nodes, edges, initChild, allEvents, initialState };
}

export function expandInitChain(state: string, initChild: ReadonlyMap<string, string>): string[] {
  const result: string[] = [state];
  let cur = state;
  for (;;) { const next = initChild.get(cur); if (next === undefined) break; cur = next; result.push(cur); }
  return result;
}

function reconstructPath(prev: Map<string, string>, from: string, to: string): string[] {
  const path: string[] = [to];
  let node: string = to;
  while (node !== from) { const p = prev.get(node); if (p === undefined) break; node = p; path.unshift(node); }
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

  for (const v of nodes.keys()) {
    if (!idx.has(v)) sc(v);
  }
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
