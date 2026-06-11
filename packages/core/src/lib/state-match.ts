import type {
  Actor,
  AnyActorLogic,
  AnyStateMachine,
  EventFromLogic,
  SnapshotFrom,
  StateSchemaFrom,
  StateValue,
} from 'xstate';
import { getSchemas } from './schemas';
import { validateAndSend } from './validate';

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

// ─── Monoid (foldMap 用) ────────────────────────────────────────────────────

/** foldMap に渡すモノイド。empty が単位元、combine が二項演算 */
export interface Monoid<M> {
  readonly empty: M;
  readonly combine: (a: M, b: M) => M;
}

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

/** fold / collect / foldMap / attempt / zip に渡す cases オブジェクトの型 */
type FoldCases<TTree extends StateTree, TEvent, TContext, T> = {
  [K in keyof TTree & string]?: (scope: StateScope<TTree[K], TEvent, TContext, K>) => T;
};

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
   * マシンが終了状態（snapshot.done === true、type: 'final' 到達）のとき cb を実行。
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
  /** どの分岐にも一致しなかった時に実行（default） */
  otherwise(cb: () => void): void;

  // ── 合成メソッド ────────────────────────────────────────────────────────────

  /**
   * 全一致を収集して T[] で返す。
   * fold が「最初のマッチで終了」するのに対し、collect は parallel state の
   * 複数アクティブ状態を含む全マッチを収集する。
   */
  collect<T>(cases: FoldCases<TTree, TEvent, TContext, T>): T[];

  /**
   * Matcher → value な変換関数を最大 4 段まで合成する。
   * 「ローディング中の振る舞い」「エラー時の振る舞い」を関数として分離し再利用できる。
   */
  pipe<A>(f: (m: Matcher<TTree, TEvent, TContext>) => A): A;
  pipe<A, B>(
    f1: (m: Matcher<TTree, TEvent, TContext>) => A,
    f2: (a: A) => B,
  ): B;
  pipe<A, B, C>(
    f1: (m: Matcher<TTree, TEvent, TContext>) => A,
    f2: (a: A) => B,
    f3: (b: B) => C,
  ): C;
  pipe<A, B, C, D>(
    f1: (m: Matcher<TTree, TEvent, TContext>) => A,
    f2: (a: A) => B,
    f3: (b: B) => C,
    f4: (c: C) => D,
  ): D;

  /**
   * 値・matched フラグを一切変えずに副作用だけ差し込む。
   * in/when は matched フラグを立てるが、tapAlways は絶対に変えない。
   * ログ・テレメトリ専用の純粋な観測レーン。
   */
  tapAlways(cb: (ctx: TContext) => void): Matcher<TTree, TEvent, TContext>;

  /**
   * TContext を U に変換して Matcher<TTree, TEvent, U> を返す。
   * 後続の in/fold/when が変換後の型を見る。
   */
  map<U>(fn: (ctx: TContext) => U): Matcher<TTree, TEvent, U>;

  /**
   * モノイドを渡して全一致を畳み込む。
   * fold は「1件だけ」、collect は「T[]」、foldMap は「モノイドで集約した M」。
   */
  foldMap<M>(monoid: Monoid<M>, cases: FoldCases<TTree, TEvent, TContext, M>): M;

  /**
   * matched === false のとき factory() の Matcher にフォールバックする。
   * otherwise() との違いはチェーンを継続できる点。
   */
  orElse(factory: () => Matcher<TTree, TEvent, TContext>): Matcher<TTree, TEvent, TContext>;

  /**
   * チェーン全体への前提条件ゲート。pred が false のとき、以降の in/when/fold/collect を
   * すべてスキップする。otherwise は pred の前の matched フラグに従って動作するため、
   * filter 以前に何もマッチしていなければ otherwise は実行される。
   */
  filter(pred: (ctx: TContext) => boolean): Matcher<TTree, TEvent, TContext>;

  /**
   * ケースハンドラーの例外を型安全に捕捉する。
   * fold は例外を素通しするが、attempt は { ok: false, error } に変換して返す。
   * _ あり overload は value が必ず T になる。
   */
  attempt<T>(
    cases: FoldCases<TTree, TEvent, TContext, T> & { _: () => T },
  ): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
  attempt<T>(
    cases: FoldCases<TTree, TEvent, TContext, T>,
  ):
    | { readonly ok: true; readonly value: T | undefined }
    | { readonly ok: false; readonly error: unknown };

  /**
   * 2 つの fold cases を同一スナップショットで評価してタプルで返す。
   * 両方に _ を渡すと readonly [A, B] を保証する overload になる。
   */
  zip<A, B>(
    casesA: FoldCases<TTree, TEvent, TContext, A> & { _: () => A },
    casesB: FoldCases<TTree, TEvent, TContext, B> & { _: () => B },
  ): readonly [A, B];
  zip<A, B>(
    casesA: FoldCases<TTree, TEvent, TContext, A>,
    casesB: FoldCases<TTree, TEvent, TContext, B>,
  ): readonly [A | undefined, B | undefined];

  /**
   * 未マッチの場合に context から Matcher を動的生成してチェーンに接続する。
   * 既にマッチしている場合は fn を呼ばず self を返す。
   * orElse と異なり、context の値によって使う Matcher 自体を切り替えられる。
   *
   * 注意: 一般的な monadic bind (>>=) とは異なる。マッチ済みの場合に fn を呼ばない
   * という意味論を持つため、「未マッチ時のコンテキスト依存フォールバック」として使う。
   */
  fallbackWith(
    fn: (ctx: TContext) => Matcher<TTree, TEvent, TContext>,
  ): Matcher<TTree, TEvent, TContext>;
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

/**
 * filter(false) が返す gated Matcher。
 * 状態マッチメソッドはすべて no-op になるが、otherwise は filter 呼び出し前の
 * matched フラグを参照するため、事前にマッチしていなければ otherwise は実行される。
 */
function makeGatedMatcher(
  matched: MatchedRef,
  context: unknown,
): Matcher<StateTree, unknown, unknown> {
  let gated: Matcher<StateTree, unknown, unknown>;
  const noopFold = (): undefined => undefined;
  gated = {
    in: () => gated,
    within: () => gated,
    inAny: () => gated,
    when: () => gated,
    done: () => gated,
    fold: noopFold as never,
    collect: () => [],
    pipe: ((...fns: Array<(m: unknown) => unknown>) =>
      fns.reduce((acc: unknown, fn) => fn(acc), gated as unknown)) as never,
    tapAlways: () => gated,
    map: () => gated as never,
    foldMap: ((monoid: Monoid<unknown>) => monoid.empty) as never,
    orElse(factory) {
      if (!matched.matched) {
        return factory() as Matcher<StateTree, unknown, unknown>;
      }
      return gated;
    },
    filter: () => gated,
    attempt: () => ({ ok: true as const, value: undefined }),
    zip: () => [undefined, undefined] as const as never,
    fallbackWith(fn) {
      if (matched.matched) return gated;
      return (fn as (ctx: unknown) => Matcher<StateTree, unknown, unknown>)(context);
    },
    otherwise(cb) {
      if (!matched.matched) cb();
    },
  };
  return gated;
}

function makeMatcher(
  parentPath: readonly string[],
  value: StateValue,
  send: SendFn,
  context: unknown,
  matched: MatchedRef,
  isDone: boolean,
): Matcher<StateTree, unknown, unknown> {
  // fold だけは overload 対応のため関数を先に定義してキャストする
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

  // collect: 全一致を収集（parallel state 対応）
  const collectImpl = (
    cases: Record<string, ((scope: unknown) => unknown) | undefined>,
  ): unknown[] => {
    const results: unknown[] = [];
    for (const [key, fn] of Object.entries(cases)) {
      if (key === '_' || typeof fn !== 'function') continue;
      if (pathMatches(value, [...parentPath, key])) {
        results.push(fn({ send, context, value: key }));
      }
    }
    return results;
  };

  // foldMap: モノイドで全一致を畳み込む
  const foldMapImpl = (
    monoid: Monoid<unknown>,
    cases: Record<string, ((scope: unknown) => unknown) | undefined>,
  ): unknown => {
    let acc = monoid.empty;
    for (const [key, fn] of Object.entries(cases)) {
      if (key === '_' || typeof fn !== 'function') continue;
      if (pathMatches(value, [...parentPath, key])) {
        acc = monoid.combine(acc, fn({ send, context, value: key }));
      }
    }
    return acc;
  };

  // attempt: fold の例外捕捉版
  const attemptImpl = (
    cases: Record<string, ((scope: unknown) => unknown) | undefined>,
  ): { ok: boolean; value?: unknown; error?: unknown } => {
    try {
      return { ok: true, value: foldImpl(cases) };
    } catch (error) {
      return { ok: false, error };
    }
  };

  // zip: 2 つの fold を同一スナップショットで評価してタプルで返す
  const zipImpl = (
    casesA: Record<string, ((scope: unknown) => unknown) | undefined>,
    casesB: Record<string, ((scope: unknown) => unknown) | undefined>,
  ): readonly [unknown, unknown] => {
    return [foldImpl(casesA), foldImpl(casesB)] as const;
  };

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
    otherwise(cb) {
      if (!matched.matched) cb();
    },

    // ── 合成メソッド ──────────────────────────────────────────────────────────

    collect: collectImpl as never,

    pipe: ((...fns: Array<(m: unknown) => unknown>) =>
      fns.reduce((acc: unknown, fn) => fn(acc), self as unknown)) as never,

    tapAlways(cb) {
      (cb as (ctx: unknown) => void)(context);
      return self;
    },

    map(fn) {
      return makeMatcher(
        parentPath,
        value,
        send,
        (fn as (ctx: unknown) => unknown)(context),
        matched,
        isDone,
      ) as never;
    },

    foldMap: foldMapImpl as never,

    orElse(factory) {
      if (!matched.matched) {
        return factory() as Matcher<StateTree, unknown, unknown>;
      }
      return self;
    },

    filter(pred) {
      if (!(pred as (ctx: unknown) => boolean)(context)) {
        return makeGatedMatcher(matched, context);
      }
      return self;
    },

    attempt: attemptImpl as never,

    zip: zipImpl as never,

    fallbackWith(fn) {
      if (matched.matched) return self;
      return (fn as (ctx: unknown) => Matcher<StateTree, unknown, unknown>)(
        context,
      ) as Matcher<StateTree, unknown, unknown>;
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
 * isDone は snapshot.done をそのまま渡す（省略時 false）。
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
 * actor が typedSetup で作られた場合は Zod スキーマによるイベント検証を自動的に行う。
 *
 * 基本メソッド:
 * - `.in(name, scope => ...)` — 状態名マッチ
 * - `.within(name, child => ...)` — 複合状態への潜降
 * - `.inAny(names, cb)` — 複数状態の OR マッチ
 * - `.when(guard, cb)` — コンテキスト述語マッチ
 * - `.done(cb)` — 終了状態マッチ（snapshot.done === true）
 * - `.fold(cases)` — 値を返す網羅的パターンマッチ
 * - `.otherwise(cb)` — フォールバック
 *
 * 合成メソッド:
 * - `.collect(cases)` — 全一致を T[] で収集
 * - `.pipe(f1, f2, ...)` — 変換関数を最大 4 段合成
 * - `.tapAlways(cb)` — matched を変えずに副作用を差し込む
 * - `.map(fn)` — context 型を変換
 * - `.foldMap(monoid, cases)` — モノイドで全一致を集約
 * - `.orElse(factory)` — 未マッチ時に別 Matcher へフォールバック
 * - `.filter(pred)` — チェーン全体への前提条件ゲート（false のとき matching をスキップ）
 * - `.attempt(cases)` — ハンドラ例外を { ok, value/error } に捕捉
 * - `.zip(casesA, casesB)` — 2 つの fold を同時評価してタプルで返す
 * - `.fallbackWith(fn)` — 未マッチ時に context から Matcher を動的生成して接続
 *
 * @example
 * matchActor(actorRef)
 *   .in('idle', idle => idle.send({ type: 'FETCH' }))
 *   .in('loading', l => l.send({ type: 'CANCEL' }))
 *   .within('loggedIn', s => s
 *     .in('active', a => a.send({ type: 'GO_IDLE' })))
 *   .otherwise(() => {});
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
 * const [label, cssClass] = matchActor(actorRef).zip(
 *   { idle: () => 'Ready', loading: () => 'Busy', _: () => 'Unknown' },
 *   { idle: () => 'btn-primary', loading: () => 'btn-loading', _: () => 'btn-secondary' },
 * );
 */
export function matchActor<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
): StateMatcherFor<TLogic> {
  const snapshot = actor.getSnapshot() as {
    value: StateValue;
    context: unknown;
    status: string;
  };
  const schemas = getSchemas(actor.logic);
  const send: SendFn = (event) => {
    validateAndSend(actor, event as Parameters<Actor<TLogic>['send']>[0], schemas);
  };
  return buildStateMatcher(
    snapshot.value,
    send,
    snapshot.context,
    snapshot.status === 'done',
  ) as never;
}
