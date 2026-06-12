import type { AnyActorRef, AnyStateMachine, StateValue } from 'xstate';
import {
  getMachineRoot,
  getActorMachineRoot,
  getNodeTransitionMap,
  type V5StateNode,
} from './compat/xstate-v5';

function isActor(input: AnyStateMachine | AnyActorRef): input is AnyActorRef {
  return typeof (input as { getSnapshot?: unknown }).getSnapshot === 'function';
}

/** dot-path → Mermaid-safe identifier (dots replaced by underscores) */
function mermaidId(dotPath: string): string {
  return dotPath.replaceAll('.', '_');
}

function collectActive(value: StateValue, prefix: string, out: Set<string>): void {
  if (typeof value === 'string') {
    out.add(prefix ? `${prefix}.${value}` : value);
  } else {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.add(path);
      if (v != null) collectActive(v, path, out);
    }
  }
}

function emitTransitions(child: V5StateNode, mid: string, indent: string, lines: string[]): void {
  for (const [, defs] of getNodeTransitionMap(child)) {
    for (const t of defs) {
      if (t.eventType === '*') continue;
      const tgt = t.target?.[0];
      if (tgt) {
        lines.push(`${indent}${mid} --> ${mermaidId(tgt.path.join('.'))} : ${t.eventType}`);
      }
    }
  }
}

function walkParallel(
  entries: [string, V5StateNode][],
  indent: string,
  lines: string[],
  activeKeys: Set<string> | undefined,
  pathPrefix: string,
): void {
  entries.forEach(([key, child], idx) => {
    const dotPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const mid = mermaidId(dotPath);
    if (Object.keys(child.states).length > 0) {
      const alias = pathPrefix ? `state "${key}" as ${mid}` : `state ${key}`;
      lines.push(`${indent}${alias} {`);
      if (typeof child.config.initial === 'string') {
        lines.push(`${indent}    [*] --> ${mermaidId(`${dotPath}.${child.config.initial}`)}`);
      }
      walk(child, `${indent}    `, lines, activeKeys, dotPath);
      lines.push(`${indent}}`);
    }
    if (activeKeys !== undefined && activeKeys.has(dotPath)) {
      lines.push(`${indent}class ${mid} active`);
    }
    if (idx < entries.length - 1) lines.push(`${indent}--`);
  });
}

function walk(
  node: V5StateNode,
  indent: string,
  lines: string[],
  activeKeys: Set<string> | undefined,
  pathPrefix = '',
): void {
  const entries = Object.entries(node.states);
  if (node.type === 'parallel') {
    walkParallel(entries, indent, lines, activeKeys, pathPrefix);
    return;
  }

  for (const [key, child] of entries) {
    const dotPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const mid = mermaidId(dotPath);
    const isNested = pathPrefix.length > 0;

    if (child.type === 'final') {
      lines.push(`${indent}${mid} --> [*]`);
    } else if (child.type === 'history') {
      const decl = isNested ? `state "${key}" as ${mid} <<history>>` : `state ${key} <<history>>`;
      lines.push(`${indent}${decl}`);
    } else if (Object.keys(child.states).length > 0) {
      const header = isNested ? `state "${key}" as ${mid}` : `state ${key}`;
      lines.push(`${indent}${header} {`);
      if (child.type !== 'parallel' && typeof child.config.initial === 'string') {
        lines.push(`${indent}    [*] --> ${mermaidId(`${dotPath}.${child.config.initial}`)}`);
      }
      walk(child, `${indent}    `, lines, activeKeys, dotPath);
      lines.push(`${indent}}`);
    } else if (isNested) {
      lines.push(`${indent}state "${key}" as ${mid}`);
    }

    emitTransitions(child, mid, indent, lines);

    if (activeKeys !== undefined && activeKeys.has(dotPath)) {
      lines.push(`${indent}class ${mid} active`);
    }
  }
}

/**
 * machine または actor の状態階層を Mermaid stateDiagram-v2 文字列にする純粋関数。
 * 状態ノードにはドットパス由来のグローバル一意 ID を使うため、同名の状態が
 * 複数の複合状態に存在しても衝突しない。
 *
 * - machine を渡すと静的な構造ダイアグラム
 * - actor を渡すと現在アクティブな状態に classDef active スタイルを付与
 *
 * @example
 * console.log(renderMermaid(authMachine));   // 構造
 * console.log(renderMermaid(actorRef));      // 現在状態付き
 */
export function renderMermaid(input: AnyStateMachine | AnyActorRef): string {
  const root = isActor(input) ? getActorMachineRoot(input) : getMachineRoot(input);
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
