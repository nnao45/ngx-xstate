// Adapters for XState v5 internals (^5.32.0).
// All casts to `unknown` are contained here. Review on any minor bump.
import { createActor, type AnyMachineSnapshot, type AnyStateMachine } from 'xstate';
import type { AnyActorRef } from 'xstate';

// ── Internal shapes ────────────────────────────────────────────────────────────

export interface V5StateNode {
  readonly key: string;
  readonly type: string;
  readonly path: readonly string[];
  readonly states: Record<string, V5StateNode>;
  readonly config: { readonly initial?: unknown };
  readonly transitions?: Map<string, V5TransitionDef[]>;
}

export interface V5TransitionDef {
  readonly target: Array<{ readonly path: readonly string[]; readonly key: string }> | undefined;
  readonly eventType: string;
  readonly guard?: unknown;
  readonly actions?: readonly unknown[];
}

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getMachineRoot(machine: AnyStateMachine): V5StateNode {
  return (machine as unknown as { root: V5StateNode }).root;
}

export function getActorMachineRoot(actor: AnyActorRef): V5StateNode {
  return (actor as unknown as { logic: { root: V5StateNode } }).logic.root;
}

export function getNodeTransitionMap(node: V5StateNode): Map<string, V5TransitionDef[]> {
  return (node.transitions ?? new Map()) as Map<string, V5TransitionDef[]>;
}

export function getSnapshotValue(snapshot: AnyMachineSnapshot): unknown {
  return (snapshot as unknown as { value: unknown }).value;
}

export function getInitialSnapshot(machine: AnyStateMachine): AnyMachineSnapshot {
  return createActor(machine).getSnapshot() as AnyMachineSnapshot;
}

export function getMachineGuardImplementations(machine: AnyStateMachine): Record<string, unknown> {
  const impl = (
    machine as unknown as {
      implementations?: { guards?: Record<string, unknown> };
    }
  ).implementations;
  return impl?.guards ?? {};
}

// ── Name extraction ────────────────────────────────────────────────────────────

// explainGuard() attaches this key to the guard function so we can surface
// the human-readable label in TransitionInfo.guardLabel.
export const GUARD_LABEL_KEY = '__zstate_guard_label__';

export function guardName(guard: unknown): string | undefined {
  if (guard == null) return undefined;
  if (typeof guard === 'string') return guard;
  if (typeof guard === 'function') {
    const n = (guard as { name?: string }).name;
    return n != null && n !== 'guard' ? n : '(fn)';
  }
  if (typeof guard === 'object' && guard !== null) {
    const t = (guard as Record<string, unknown>)['type'];
    if (typeof t === 'string') return t;
  }
  return '(unknown)';
}

export function extractGuardLabel(guard: unknown): string | undefined {
  if (guard == null) return undefined;
  const obj = guard as Record<string | symbol, unknown>;
  const label = obj[GUARD_LABEL_KEY];
  return typeof label === 'string' ? label : undefined;
}

export function actionName(action: unknown): string {
  if (typeof action === 'string') return action;
  if (typeof action === 'function') {
    const n = (action as { name?: string }).name;
    return n != null && n !== 'anonymous' ? n : '(fn)';
  }
  if (typeof action === 'object' && action !== null) {
    const t = (action as Record<string, unknown>)['type'];
    if (typeof t === 'string') return t;
  }
  return '(unknown)';
}

// ── Snapshot value helpers ─────────────────────────────────────────────────────

function dotJoin(prefix: string, key: string): string {
  return prefix.length > 0 ? `${prefix}.${key}` : key;
}

export function activeLeaves(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [dotJoin(prefix, value)];
  if (typeof value !== 'object' || value === null) return prefix ? [prefix] : [];
  const r: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    r.push(...activeLeaves(v, dotJoin(prefix, k)));
  return r;
}

export function allActiveStates(snapshot: AnyMachineSnapshot): string[] {
  function collect(value: unknown, prefix: string): string[] {
    if (typeof value === 'string') return [dotJoin(prefix, value)];
    if (typeof value !== 'object' || value === null) return prefix ? [prefix] : [];
    const result: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = dotJoin(prefix, k);
      result.push(path, ...collect(v, path));
    }
    return result;
  }
  return collect(getSnapshotValue(snapshot), '');
}

export function resolveGuardLabel(
  guard: unknown,
  impls: Record<string, unknown>,
): string | undefined {
  const direct = extractGuardLabel(guard);
  if (direct !== undefined) return direct;
  const n = guardName(guard);
  return n !== undefined && n !== '(fn)' && n !== '(unknown)'
    ? extractGuardLabel(impls[n])
    : undefined;
}
