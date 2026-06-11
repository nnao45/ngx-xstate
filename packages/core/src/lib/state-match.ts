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

/** fold / collect / foldMap に渡す cases オブジェクトの型 */
type MatchCases<TTree extends StateTree, TEvent, TContext, T> = {
  [K in keyof TTree & string]?: (scope: StateScope<TTree[K], TEvent, TContext, K>) => T;
};

/** fold に渡す cases オブジェクトの型（後方互換のため残す） */
type FoldCases<TTree extends StateTree, TEvent, TContext, T> = MatchCases<
  TTree,
  TEvent,
  TContext,
  T
>;

/**
 * foldMap に渡すモノイド。
 * - `empty` : 単位元（何もマッチしなかった時の戻り値）
 * - `combine`: 二項演算（左結合で畳み込む）
 */
export interface Monoid<M> {
  readonly empty: M;
  readonly combine: (a: M, b: M) => M;
}

/** pipe の各ステップ: Matcher を受け取り Matcher か最終値を返す関数 */
type MatcherTransform<TTree extends StateTree, TEvent, TContext> = (
  m: Matcher<TTree, TEvent, TContext>,
) => Matcher<TTree, TEvent, TContext>;

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
    cb: (child: Matcher<TTree[K]['children'], TEvent, TContext>) => unknown,
  ): Matcher<TTree, TEvent, TContext>;
  /**
   * 複数の状態名を OR で照合する。names のいずれか一つに一致したら cb を実行。
   * 一致した場合は matched フラグを立て、`.otherwise` を抑制する。
   */
  inAny<K extends keyof TTree & string>(
    names: readonly K[],
    cb: (scope: StateScope<TTree[K], TEvent, TContext, K>) => void,
  ): Matcher<TTree, TEvent, TContext>;
  /**
   * context の述語 guard が true を返すとき cb を実行。
   * 状態名ではなくコンテキストの値でマッチしたい場合に使う。
   */
  when(
    guard: (ctx: TContext) => boolean,
    cb: (ctx: TContext) => void,
  ): Matcher<TTree, TEvent, TContext>;
  /**
   * マシンが終了状態（snapshot.status === 'done'、type: 'final' 到達）のとき cb を実行。
   * 状態名ではなく FSM の終了という意味論でマッチする。
   */
  done(cb: (ctx: TContext) => void): Matcher<TTree, TEvent, TContext>;
  /**
   * 状態ごとに値を返す写像。現在状態に対応するハンドラを実行して T を返す。
   * フォールバック _ を渡すと非一致時も T を返すため、戻り値は必ず T になる。
   * _ なしの場合、非一致なら undefined を返す。
   */
  fold<T>(cases: FoldCases<TTree, TEvent, TContext, T> & { _: () => T }): T;
  fold<T>(cases: FoldCases<TTree, TEvent, TContext, T>): T | undefined;

  // ── Cats Effect 系メソッド ─────────────────────────────────────────────────

  /**
   * FlatMap.flatTap: matched フラグを変えずに context への副作用だけを差し込む。
   * ログ・テレメトリ等で「観測するが otherwise の挙動を変えたくない」場合に使う。
   * in / when と違い、このメソッドは matched を立てない。
   */
  tapAlways(cb: (ctx: TContext) => void): Matcher<TTree, TEvent, TContext>;
  /**
   * Functor / ReaderT.local: context を変換した新しい Matcher を返す。
   * 後続の in / fold / when は変換後の context 型 U を受け取る。
   * matched フラグは元の Matcher と共有するため otherwise への影響はそのまま引き継がれる。
   */
  mapContext<U>(fn: (ctx: TContext) => U): Matcher<TTree, TEvent, U>;
  /**
   * Foldable.toList: 現在の階層で一致した全ケースの戻り値を配列で返す。
   * 並列状態（type: 'parallel'）では複数要素が返る。fold は最初の一致で終了するが
   * collect はすべての一致を収集する。
   */
  collect<T>(cases: MatchCases<TTree, TEvent, TContext, T>): T[];
  /**
   * Foldable.foldMap: 一致した全ケースの戻り値をモノイドで畳み込む。
   * collect は Array モノイドの特殊ケース。
   * 並列状態で複数一致した場合 monoid.combine を左結合で適用する。
   * 何も一致しなければ monoid.empty を返す。
   */
  foldMap<M>(
    monoid: Monoid<M>,
    cases: MatchCases<TTree, TEvent, TContext, M>,
  ): M;
  /**
   * Kleisli 合成 / Reader 変換: Matcher を受け取る変換関数を順に適用する。
   * 再利用可能な「状態ビヘイビア」関数を合成して Matcher に適用できる。
   *
   * @example
   * const withSpinner = (m: Matcher<...>) => m.inAny(['loading', 'fetching'], () => show())
   * const withError   = (m: Matcher<...>) => m.in('error', s => toast(s.context.msg))
   * matchActor(actor).pipe(withSpinner, withError).otherwise(() => hide())
   */
  pipe<A>(fn1: (m: Matcher<TTree, TEvent, TContext>) => A): A;
  pipe<A>(
    fn1: MatcherTransform<TTree, TEvent, TContext>,
    fn2: (m: Matcher<TTree, TEvent, TContext>) => A,
  ): A;
  pipe<A>(
    fn1: MatcherTransform<TTree, TEvent, TContext>,
    fn2: MatcherTransform<TTree, TEvent, TContext>,
    fn3: (m: Matcher<TTree, TEvent, TContext>) => A,
  ): A;
  pipe<A>(
    fn1: MatcherTransform<TTree, TEvent, TContext>,
    fn2: MatcherTransform<TTree, TEvent, TContext>,
    fn3: MatcherTransform<TTree, TEvent, TContext>,
    fn4: (m: Matcher<TTree, TEvent, TContext>) => A,
  ): A;

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
  isDone: boolean,
): Matcher<StateTree, unknown, unknown> {
  // generic / overload メソッドは関数を先に定義してキャストする（contextual typing が壊れるのを防ぐ）
  const foldImpl = (
    cases: Record<string, ((scope: unknown) => unknown) | undefined>,
  ): unknown => {
    for (const [key, fn] of Object.entries(cases)) {
      if (key === '_' || typeof fn !== 'function') continue;
      if (pathMatches(value, [...parentPath, key])) {
        return fn({ send, context, value: key });
      }
    }
    const fallback = cases['_'];
    return typeof fallback === 'function' ? fallback(undefined) : undefined;
  };

  const collectImpl = (
    cases: Record<string, ((scope: unknown) => unknown) | undefined>,
  ): unknown[] => {
    const results: unknown[] = [];
    for (const [key, fn] of Object.entries(cases)) {
      if (typeof fn !== 'function') continue;
      if (pathMatches(value, [...parentPath, key])) {
        results.push(fn({ send, context, value: key }));
      }
    }
    return results;
  };

  const foldMapImpl = (
    monoid: { empty: unknown; combine: (a: unknown, b: unknown) => unknown },
    cases: Record<string, ((scope: unknown) => unknown) | undefined>,
  ): unknown => {
    let acc = monoid.empty;
    for (const [key, fn] of Object.entries(cases)) {
      if (typeof fn !== 'function') continue;
      if (pathMatches(value, [...parentPath, key])) {
        acc = monoid.combine(acc, fn({ send, context, value: key }));
      }
    }
    return acc;
  };

  const pipeImpl = (...fns: Array<(m: unknown) => unknown>): unknown =>
    fns.reduce((acc, fn) => fn(acc), self as unknown);

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
      const child = makeMatcher(
        childPath,
        value,
        send,
        context,
        { matched: !parentActive },
        isDone,
      );
      cb(child as never);
      if (parentActive) matched.matched = true;
      return self;
    },
    inAny(names, cb) {
      for (const name of names) {
        if (pathMatches(value, [...parentPath, name])) {
          matched.matched = true;
          cb({ send, context, value: name } as never);
          return self;
        }
      }
      return self;
    },
    when(guard, cb) {
      if (guard(context)) {
        matched.matched = true;
        cb(context);
      }
      return self;
    },
    done(cb) {
      if (isDone) {
        matched.matched = true;
        cb(context);
      }
      return self;
    },
    fold: foldImpl as never,
    tapAlways(cb) {
      cb(context);
      return self;
    },
    mapContext(fn) {
      const newCtx = (fn as (ctx: unknown) => unknown)(context);
      // matched を共有することで元のチェーンの otherwise に影響が伝わる
      return makeMatcher(parentPath, value, send, newCtx, matched, isDone) as never;
    },
    collect: collectImpl as never,
    foldMap: foldMapImpl as never,
    pipe: pipeImpl as never,
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
 * isDone は snapshot.status === 'done' をそのまま渡す（省略時 false）。
 */
export function buildStateMatcher(
  value: StateValue,
  send: (event: { type: string }) => void,
  context: unknown,
  isDone = false,
): Matcher<StateTree, unknown, unknown> {
  return makeMatcher([], value, send, context, { matched: false }, isDone);
}

/**
 * actor の現在状態に対する型安全な case/when マッチャを作る。
 *
 * 副作用メソッド（matched フラグに影響）:
 *   `.in` `.within` `.inAny` `.when` `.done`  → 一致すれば `.otherwise` を抑制
 *
 * 観測専用（matched フラグに影響しない）:
 *   `.tapAlways`  → 常に副作用、otherwise に影響なし
 *
 * 変換メソッド（新しい Matcher を返す）:
 *   `.mapContext`  → context を変換（Functor / ReaderT.local）
 *   `.pipe`        → 変換関数を合成（Kleisli）
 *
 * 値抽出メソッド（終端操作）:
 *   `.fold`        → 最初の一致から T を返す
 *   `.collect`     → 全一致を T[] で返す（並列状態対応）
 *   `.foldMap`     → 全一致をモノイドで畳み込む（collect の一般化）
 *
 * @example
 * const label = matchActor(actorRef).fold({
 *   idle:    () => 'Ready',
 *   loading: s  => `Loading (retry ${s.context.retries})`,
 *   success: () => 'Done',
 *   _:       () => 'Unknown',
 * });
 *
 * @example
 * const withSpinner = (m: typeof matcher) =>
 *   m.inAny(['loading', 'fetching'], () => showSpinner())
 * matchActor(actorRef).pipe(withSpinner).otherwise(() => hideSpinner())
 */
export function matchActor<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): StateMatcherFor<TLogic> {
  const snapshot = actor.getSnapshot() as {
    value: StateValue;
    context: unknown;
    status: string;
  };
  const send: SendFn = (event) => {
    actor.send(event as EventFromLogic<TLogic>);
  };
  return buildStateMatcher(
    snapshot.value,
    send,
    snapshot.context,
    snapshot.status === 'done',
  ) as never;
}
