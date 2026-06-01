import type {
  Actor,
  AnyActorLogic,
  AnyStateMachine,
  EventFromLogic,
  SnapshotFrom,
  StateSchemaFrom,
  StateValue,
} from 'xstate';

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

type EmptyTree = Record<never, never>;

// brand 不在（素の xstate set() / createMachine）時のフォールバック。
// XState は StateSchema の `on` を unknown に潰すため「状態別イベント」は型から
// 復元できないが、`states` 階層（＝状態名ツリー）は保持される。そこからツリーを
// 導出し、各ノードの有効イベントは machine 全イベントにフォールバックする。
// → 状態名マッチ / .within / .otherwise は完全に効き、scope.send だけが全イベント許可になる。
type AllEventTypes<TLogic extends AnyActorLogic> = EventFromLogic<TLogic>['type'] & string;

type LooseTreeFromSchema<TSchema, TEvents extends string> = TSchema extends { states: infer S }
  ? {
      [K in keyof S & string]: {
        events: TEvents;
        children: LooseTreeFromSchema<S[K], TEvents>;
      };
    }
  : EmptyTree;

type FallbackTree<TLogic extends AnyActorLogic> = TLogic extends AnyStateMachine
  ? LooseTreeFromSchema<StateSchemaFrom<TLogic>, AllEventTypes<TLogic>>
  : EmptyTree;

type TreeFromLogic<TLogic extends AnyActorLogic> = TLogic extends { [STATE_TREE]?: infer T }
  ? T extends StateTree
    ? T
    : FallbackTree<TLogic>
  : FallbackTree<TLogic>;

// ─── Matcher の型 ─────────────────────────────────────────────────────────────

/** 状態 S で有効なイベント（machine 全イベント union を on キーで絞り込む） */
type EventsInNode<TNode extends StateNodeShape, TEvent> = Extract<
  TEvent,
  { type: TNode['events'] }
>;

/** 子を持つ（＝潜れる）複合状態のキーだけ抽出する。葉状態は never に落ちる */
type CompoundKeys<TTree extends StateTree> = {
  [K in keyof TTree]: keyof TTree[K]['children'] extends never ? never : K;
}[keyof TTree] &
  string;

/** in / within のコールバックに渡る、一致状態のスコープ */
export interface StateScope<TNode extends StateNodeShape, TEvent, TContext, TName extends string> {
  /** この状態で有効なイベントだけ受け付ける send */
  readonly send: (event: EventsInNode<TNode, TEvent>) => void;
  /** 現在の context（readonly） */
  readonly context: TContext;
  /** 一致した状態名 */
  readonly value: TName;
}

/**
 * case/when チェーン。`in` はこの階層の状態を横に分岐し、`within` は複合状態の
 * 子へスコープ付きで潜る（コールバックを抜けると外側＝この階層に戻る）。
 */
export interface Matcher<TTree extends StateTree, TEvent, TContext> {
  /** この階層の状態 name に現在一致していれば cb を実行。同じ階層の Matcher を返す */
  in<K extends keyof TTree & string>(
    name: K,
    cb: (scope: StateScope<TTree[K], TEvent, TContext, K>) => void,
  ): Matcher<TTree, TEvent, TContext>;
  /**
   * 複合状態 name の子へ潜る。cb には子状態を対象にした Matcher が渡る。
   * cb を抜けると外側（この階層）の Matcher を返すので、続けて別のトップ状態を
   * `.in()` / `.within()` できる。
   */
  within<K extends CompoundKeys<TTree>>(
    name: K,
    // 戻り値は無視する。`s => s.in(...)` のショートハンドで子 Matcher を返せるよう unknown。
    cb: (child: Matcher<TTree[K]['children'], TEvent, TContext>) => unknown,
  ): Matcher<TTree, TEvent, TContext>;
  /** どの分岐にも一致しなかった時に実行（default） */
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

function makeMatcher(
  parentPath: readonly string[],
  value: StateValue,
  send: SendFn,
  context: unknown,
  matched: MatchedRef,
): Matcher<StateTree, unknown, unknown> {
  const self: Matcher<StateTree, unknown, unknown> = {
    in(name, cb) {
      if (pathMatches(value, [...parentPath, name])) {
        matched.matched = true;
        cb({ send, context, value: name } as never);
      }
      return self;
    },
    within(name, cb) {
      const childPath = [...parentPath, name];
      const parentActive = pathMatches(value, childPath);
      // 親が非アクティブなら子の otherwise を抑制するため matched を true で seed する
      const child = makeMatcher(childPath, value, send, context, { matched: !parentActive });
      cb(child as never);
      if (parentActive) matched.matched = true;
      return self;
    },
    otherwise(cb) {
      if (!matched.matched) cb();
    },
  };
  return self;
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
 * `.in(name, scope => ...)` はその状態のときだけ cb を実行し、`scope.send` はその状態で
 * 有効なイベントだけを受け付ける。`.within(name, child => ...)` で複合状態の子へ潜り、
 * コールバックを抜けると外側（同じ階層）に戻るので別のトップ状態を続けて分岐できる。
 *
 * @example
 * matchActor(actorRef)
 *   .in('idle', idle => idle.send({ type: 'FETCH' }))
 *   .in('loading', l => l.send({ type: 'CANCEL' }))
 *   .within('loggedIn', s => s
 *     .in('active', a => a.send({ type: 'GO_IDLE' })))
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
