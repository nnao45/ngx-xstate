import type { AnyActorRef, AnyStateMachine, StateValue } from 'xstate';

interface TreeNode {
  readonly key: string;
  readonly type: string;
  readonly config: { readonly initial?: unknown };
  readonly states: Record<string, TreeNode>;
}

interface RawTransition {
  readonly target: Array<{ readonly key: string }> | undefined;
  readonly eventType: string;
}

function isActor(input: AnyStateMachine | AnyActorRef): input is AnyActorRef {
  return typeof (input as { getSnapshot?: unknown }).getSnapshot === 'function';
}

function getRoot(input: AnyStateMachine | AnyActorRef): TreeNode {
  if (isActor(input)) {
    return (input as unknown as { logic: { root: TreeNode } }).logic.root;
  }
  return (input as unknown as { root: TreeNode }).root;
}

function nodeTransitions(node: TreeNode): RawTransition[] {
  const map = (
    node as unknown as { transitions: Map<string, RawTransition[]> | undefined }
  ).transitions;
  if (!map) return [];
  const result: RawTransition[] = [];
  for (const defs of map.values()) {
    for (const def of defs) {
      if (def.eventType !== '*') result.push(def);
    }
  }
  return result;
}

function collectActive(value: StateValue, prefix: string, out: Set<string>): void {
  if (typeof value === 'string') {
    out.add(prefix ? `${prefix}.${value}` : value);
  } else {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.add(path);
      if (v) collectActive(v, path, out);
    }
  }
}

function walk(
  node: TreeNode,
  indent: string,
  lines: string[],
  activeKeys?: Set<string>,
  pathPrefix = '',
): void {
  const entries = Object.entries(node.states);

  if (node.type === 'parallel') {
    entries.forEach(([key, child], idx) => {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (Object.keys(child.states).length > 0) {
        lines.push(`${indent}state ${key} {`);
        if (typeof child.config.initial === 'string') {
          lines.push(`${indent}    [*] --> ${child.config.initial}`);
        }
        walk(child, `${indent}    `, lines, activeKeys, path);
        lines.push(`${indent}}`);
      }
      if (activeKeys?.has(path)) {
        lines.push(`${indent}class ${key} active`);
      }
      if (idx < entries.length - 1) {
        lines.push(`${indent}--`);
      }
    });
    return;
  }

  for (const [key, child] of entries) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key;
    const hasChildren = Object.keys(child.states).length > 0;

    if (child.type === 'final') {
      lines.push(`${indent}${key} --> [*]`);
    } else if (child.type === 'history') {
      lines.push(`${indent}state ${key} <<history>>`);
    } else if (hasChildren) {
      lines.push(`${indent}state ${key} {`);
      if (child.type === 'parallel') {
        walk(child, `${indent}    `, lines, activeKeys, path);
      } else {
        if (typeof child.config.initial === 'string') {
          lines.push(`${indent}    [*] --> ${child.config.initial}`);
        }
        walk(child, `${indent}    `, lines, activeKeys, path);
      }
      lines.push(`${indent}}`);
    }

    for (const t of nodeTransitions(child)) {
      if (t.target?.[0]?.key) {
        lines.push(`${indent}${key} --> ${t.target[0].key} : ${t.eventType}`);
      }
    }

    if (activeKeys?.has(path)) {
      lines.push(`${indent}class ${key} active`);
    }
  }
}

/**
 * machine または actor の状態階層を Mermaid stateDiagram-v2 文字列にする純粋関数。
 *
 * - machine を渡すと静的な構造ダイアグラム
 * - actor を渡すと現在アクティブな状態に classDef active スタイルを付与
 *
 * @example
 * console.log(renderMermaid(authMachine));   // 構造
 * console.log(renderMermaid(actorRef));      // 現在状態付き
 */
export function renderMermaid(input: AnyStateMachine | AnyActorRef): string {
  const root = getRoot(input);
  const lines: string[] = ['stateDiagram-v2'];

  let activeKeys: Set<string> | undefined;
  if (isActor(input)) {
    const snapshot = input.getSnapshot() as { value: StateValue };
    activeKeys = new Set<string>();
    collectActive(snapshot.value, '', activeKeys);
    if (activeKeys.size > 0) {
      lines.push('    classDef active font-weight:bold,stroke-width:2px');
    }
  }

  if (root.type !== 'parallel' && typeof root.config.initial === 'string') {
    lines.push(`    [*] --> ${root.config.initial}`);
  }

  walk(root, '    ', lines, activeKeys, '');

  return lines.join('\n');
}
