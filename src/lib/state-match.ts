import type { Actor, AnyActorLogic, EventFromLogic, SnapshotFrom, StateValue } from 'xstate';

// ─── 状態 Tree のブランド ───────────────────────────────────────────────────
// typedSetup の createMachine が config を捕捉して machine 型に付与する phantom。
// 素の machine 型は config.states.on を保持しないため、ここで持ち回す。

export declare const STATE_TREE: unique symbol;

/** 各状態ノード = その状態の on キー（イベント名）+ 子状態ツリー */
export interface StateNodeShape {
  readonly events: string;
  readonly children: StateTree;
}
export type StateTree = Record<string, StateNodeShape>;

/** machine config の states から StateTree を再帰導出する */
type OnKeys<S> = S extends { on: infer O } ? keyof O & string : never;
type ChildStates<S> = S extends { states: infer C } ? C : Record<never, never>;
export type StateTreeOf<States> = {
  [K in keyof States & string]: {
    events: OnKeys<States[K]>;
    children: StateTreeOf<ChildStates<States[K]>>;
  };
};

/** machine 型にブランドを付与する型 */
export type WithStateTree<TMachine, TTree extends StateTree> = TMachine & {
  readonly [STATE_TREE]?: TTree;
};

type TreeFromLogic<TLogic> = TLogic extends { [STATE_TREE]?: infer T }
  ? T extends StateTree
    ? T
    : EmptyTree
  : EmptyTree;

type EmptyTree = Record<never, never>;

// ─── Matcher / Branch の型 ───────────────────────────────────────────────────

/** 状態 S で有効なイベント（machine 全イベント union を on キーで絞り込む） */
type EventsInNode<TNode extends StateNodeShape, TEvent> = Extract<
  TEvent,
  { type: TNode['events'] }
>;

/** .tap に渡るスコープ */
export interface StateScope<TNode extends StateNodeShape, TEvent, TContext, TName extends string> {
  /** この状態で有効なイベントだけ受け付ける send */
  readonly send: (event: EventsInNode<TNode, TEvent>) => void;
  /** 現在の context（readonly） */
  readonly context: TContext;
  /** 一致した状態名 */
  readonly value: TName;
}

/** .in で選んだ 1 状態の分岐 */
export interface Branch<
  TNode extends StateNodeShape,
  TName extends string,
  TParentTree extends StateTree,
  TEvent,
  TContext,
> {
  /** 一致していれば cb を実行。兄弟へ戻る Matcher を返す */
  tap(
    cb: (scope: StateScope<TNode, TEvent, TContext, TName>) => void,
  ): Matcher<TParentTree, TEvent, TContext>;
  /** 子状態へ潜る */
  in<CK extends keyof TNode['children'] & string>(
    childName: CK,
  ): Branch<TNode['children'][CK], CK, TNode['children'], TEvent, TContext>;
}

/** case/when チェーンの起点 */
export interface Matcher<TTree extends StateTree, TEvent, TContext> {
  in<K extends keyof TTree & string>(name: K): Branch<TTree[K], K, TTree, TEvent, TContext>;
  /** どの .in にも一致しなかった時に実行 */
  otherwise(cb: () => void): void;
}

// ─── ランタイム ──────────────────────────────────────────────────────────────

type SendFn = (event: { type: string }) => void;
interface MatchedRef {
  matched: boolean;
}

/** StateValue を path（状態名の配列）でたどり、現在その path がアクティブか判定 */
function pathMatches(value: StateValue, path: readonly string[]): boolean {
  let current: StateValue = value;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i] as string;
    if (typeof current === 'string') {
      return current === seg && i === path.length - 1;
    }
    if (seg in current) {
      current = current[seg] as StateValue;
    } else {
      return false;
    }
  }
  return true;
}

function makeBranch(
  path: readonly string[],
  value: StateValue,
  send: SendFn,
  context: unknown,
  matched: MatchedRef,
): Branch<StateNodeShape, string, StateTree, unknown, unknown> {
  const active = pathMatches(value, path);
  return {
    tap(cb) {
      if (active) {
        matched.matched = true;
        cb({ send, context, value: path[path.length - 1] as string } as never);
      }
      // 親レベルの兄弟へ戻る
      return makeMatcher(path.slice(0, -1), value, send, context, matched) as never;
    },
    in(childName) {
      return makeBranch([...path, childName], value, send, context, matched) as never;
    },
  };
}

function makeMatcher(
  parentPath: readonly string[],
  value: StateValue,
  send: SendFn,
  context: unknown,
  matched: MatchedRef,
): Matcher<StateTree, unknown, unknown> {
  return {
    in(name) {
      return makeBranch([...parentPath, name], value, send, context, matched) as never;
    },
    otherwise(cb) {
      if (!matched.matched) cb();
    },
  };
}

/** 特定 logic に対する型付き Matcher */
export type StateMatcherFor<TLogic extends AnyActorLogic> = Matcher<
  TreeFromLogic<TLogic>,
  EventFromLogic<TLogic>,
  SnapshotFrom<TLogic>['context']
>;

/**
 * 現在状態値・send・context から case/when マッチャを構築する（内部用・loose型）。
 * injectActor の `.in()` は検証付き send を渡してこれを使う。
 */
export function buildStateMatcher(
  value: StateValue,
  send: (event: { type: string }) => void,
  context: unknown,
): Matcher<StateTree, unknown, unknown> {
  return makeMatcher([], value, send, context, { matched: false });
}

/**
 * actor の現在状態に対する型安全な case/when マッチャを作る。
 *
 * `.in(name)` で状態を選び、`.tap(scope => ...)` はその状態のときだけ実行される。
 * `scope.send` はその状態で有効なイベントだけを受け付ける。`.in().in()` で子状態に潜れる。
 *
 * @example
 * matchActor(actorRef)
 *   .in('idle').tap(idle => idle.send({ type: 'FETCH' }))
 *   .in('loading').tap(l => l.send({ type: 'CANCEL' }))
 *   .otherwise(() => {});
 */
export function matchActor<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): StateMatcherFor<TLogic> {
  const snapshot = actor.getSnapshot() as { value: StateValue; context: unknown };
  const send: SendFn = (event) => {
    actor.send(event as EventFromLogic<TLogic>);
  };
  return buildStateMatcher(snapshot.value, send, snapshot.context) as never;
}
