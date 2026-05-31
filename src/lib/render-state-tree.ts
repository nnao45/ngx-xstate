import type { AnyActorRef, AnyStateMachine, StateValue } from 'xstate';

/** walk に必要な StateNode の最小構造 */
interface TreeNode {
  readonly key: string;
  readonly type: string;
  readonly config: { readonly initial?: unknown };
  // XState の StateNode は atomic/final でも常に states（空 {}）を持つ
  readonly states: Record<string, TreeNode>;
}

function isActor(input: AnyStateMachine | AnyActorRef): input is AnyActorRef {
  return typeof (input as { getSnapshot?: unknown }).getSnapshot === 'function';
}

/** machine / actor からルート StateNode を取り出す（xstate 内部型との境界キャスト） */
function getRoot(input: AnyStateMachine | AnyActorRef): TreeNode {
  if (isActor(input)) {
    return (input as unknown as { logic: { root: TreeNode } }).logic.root;
  }
  return (input as unknown as { root: TreeNode }).root;
}

function isChildActive(subValue: StateValue | undefined, key: string): boolean {
  if (typeof subValue === 'string') return subValue === key;
  if (typeof subValue === 'object') return key in subValue;
  return false;
}

function childSubValue(subValue: StateValue | undefined, key: string): StateValue | undefined {
  if (typeof subValue === 'object') return subValue[key];
  return undefined;
}

function badges(parent: TreeNode, key: string, node: TreeNode): string {
  const parts: string[] = [];
  if (typeof parent.config.initial === 'string' && parent.config.initial === key) {
    parts.push('initial');
  }
  if (node.type === 'final' || node.type === 'parallel' || node.type === 'history') {
    parts.push(node.type);
  }
  return parts.length > 0 ? `  (${parts.join(', ')})` : '';
}

function walkChildren(
  parent: TreeNode,
  subValue: StateValue | undefined,
  prefix: string,
  lines: string[],
): void {
  const entries = Object.entries(parent.states);
  entries.forEach(([key, node], index) => {
    const isLast = index === entries.length - 1;
    const connector = isLast ? '└─ ' : '├─ ';
    const active = isChildActive(subValue, key);
    const marker = active ? ' ●' : '';

    lines.push(`${prefix}${connector}${key}${marker}${badges(parent, key, node)}`);

    const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
    walkChildren(node, active ? childSubValue(subValue, key) : undefined, childPrefix, lines);
  });
}

/**
 * machine または actor の状態階層を ASCII ツリー文字列にする純粋関数。
 *
 * - machine を渡すと静的な構造ツリー
 * - actor を渡すと現在アクティブな状態に `●` マーカー付き
 *
 * @example
 * console.log(renderStateTree(authMachine));   // 構造
 * console.log(renderStateTree(actorRef));      // 現在状態付き
 */
export function renderStateTree(input: AnyStateMachine | AnyActorRef): string {
  const root = getRoot(input);
  const hasActor = isActor(input);
  const rootValue: StateValue | undefined = isActor(input)
    ? (input.getSnapshot() as { value: StateValue }).value
    : undefined;

  const rootBadge = root.type === 'parallel' ? '  (parallel)' : '';
  const lines: string[] = [`${root.key}${hasActor ? ' ●' : ''}${rootBadge}`];

  walkChildren(root, rootValue, '', lines);

  return lines.join('\n');
}
