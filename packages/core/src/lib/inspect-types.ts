import type { STATE_TREE, StateTree } from './state-match';

// ─── Public types ─────────────────────────────────────────────────────────────

/** 遷移の静的情報 */
export interface TransitionInfo {
  /** "source::event::index" — 同一source+eventの複数guard遷移を区別する一意ID */
  readonly id: string;
  readonly event: string;
  readonly source: string;
  readonly target: string | undefined;
  /** 同一 source+event 内での順序（0始まり） */
  readonly index: number;
  /** guard が設定されている場合の名前または "(fn)" */
  readonly guard: string | undefined;
  /** explainGuard() で付与した人間可読ラベル */
  readonly guardLabel: string | undefined;
  /** この遷移に紐づくアクション名一覧 */
  readonly actions: readonly string[];
}

/** 有効遷移ごとの「発火したら実行されるアクション」 */
export interface CommandInfo {
  readonly event: string;
  readonly source: string;
  readonly target: string | undefined;
  readonly actions: readonly string[];
}

/** 状態列 + イベント列のペアで表したパス */
export interface InspectPath {
  /** 経由した状態名（startを含む） */
  readonly states: readonly string[];
  /** 発火したイベント列（states より1つ短い） */
  readonly events: readonly string[];
}

// ─── 再帰型デプスカウンタ ────────────────────────────────────────────────────

type DepthGuard = readonly unknown[];

// ─── Type machinery ───────────────────────────────────────────────────────────

/** StateTree を再帰的に走査して全状態パス（ドット区切り）を Union で返す（最大8段）*/
export type PathsOf<
  TTree extends StateTree,
  Prefix extends string = '',
  D extends DepthGuard = [],
> = D['length'] extends 8
  ? never
  : {
      [K in keyof TTree & string]:
        | (Prefix extends '' ? K : `${Prefix}.${K}`)
        | PathsOf<TTree[K]['children'], Prefix extends '' ? K : `${Prefix}.${K}`, [0, ...D]>;
    }[keyof TTree & string];

/** StateTree 全体から全イベント型を収集（最大8段）*/
export type AllEventsOf<TTree extends StateTree, D extends DepthGuard = []> = D['length'] extends 8
  ? never
  : {
      [K in keyof TTree & string]:
        | TTree[K]['events']
        | AllEventsOf<TTree[K]['children'], [0, ...D]>;
    }[keyof TTree & string];

/** ドットパスの状態 + その全祖先で有効なイベントの Union（最大8段）*/
export type EventsAtPath<
  TTree extends StateTree,
  P extends string,
  D extends DepthGuard = [],
> = D['length'] extends 8
  ? string
  : P extends `${infer H}.${infer T}`
    ? H extends keyof TTree
      ? TTree[H]['events'] | EventsAtPath<TTree[H]['children'], T, [0, ...D]>
      : string
    : P extends keyof TTree
      ? TTree[P]['events']
      : string;

/** machine 型から StateTree ブランドを取り出す（未付与なら基底 StateTree） */
export type ExtractTree<TMachine> = TMachine extends { readonly [STATE_TREE]?: infer T }
  ? T extends StateTree
    ? T
    : StateTree
  : StateTree;

export type OrString<T> = [T] extends [never] ? string : T;

// ─── Inspector 公開 API ───────────────────────────────────────────────────────

export interface Inspector<
  TTree extends StateTree = StateTree,
  TState extends string = OrString<PathsOf<TTree>>,
  TEvent extends string = OrString<AllEventsOf<TTree>>,
> {
  // ── 静的構造 ────────────────────────────────────────────────────────────────

  /** machine に存在する全状態名（ドット区切りパス） */
  states(): TState[];

  /** machine に定義された全イベント型 */
  events(): TEvent[];

  /**
   * 指定状態（と祖先）で送れるイベント一覧。
   * ガードは考慮しない（あくまで遷移が定義されているか）。
   */
  allowedEvents<K extends TState>(state: K): Array<EventsAtPath<TTree, K>>;

  /** 指定状態から出る遷移一覧（ガード・アクション情報付き） */
  transitionsFrom(state: TState): TransitionInfo[];

  /** 指定状態 + イベントで到達しうる全遷移先 */
  targetsFrom(state: TState, event: TEvent): TState[];

  /** type: 'final' の状態一覧 */
  terminalStates(): TState[];

  // ── グラフ解析 ──────────────────────────────────────────────────────────────

  /** 初期状態から到達可能か */
  canReach(state: TState): boolean;

  /** 初期状態から到達不能な状態一覧 */
  unreachableStates(): TState[];

  /** final でもなく外へ出る遷移もない詰み状態 */
  nonTerminalSinks(): TState[];

  /** 有向サイクルを構成する状態グループの一覧 */
  cycles(): TState[][];

  /** 指定状態がサイクルに含まれるか */
  hasCycle(state: TState): boolean;

  /**
   * 任意の 2 状態間の最短パス（BFS）。
   * 到達不能なら null。
   */
  shortestPath(from: TState, to: TState): TState[] | null;

  /**
   * 2 状態間の最小イベント数。
   * 到達不能なら -1。
   */
  stateDistance(from: TState, to: TState): number;

  /**
   * 深さ制限付き全経路（初期状態から出発）。
   * maxDepth のデフォルトは 20。
   */
  allPaths(options?: { maxDepth?: number }): InspectPath[];

  // ── スナップショット対応（ガード込み） ────────────────────────────────────

  /** 現在のスナップショットでそのイベントを送れるか（ガード評価込み） */
  canSend(snapshot: AnyMachineSnapshot, event: TEvent): boolean;

  /** イベントを送った場合の遷移先状態一覧 */
  nextStates(snapshot: AnyMachineSnapshot, event: { readonly type: TEvent }): TState[];

  /** 現在有効な遷移（ガードを通過する）一覧 */
  enabledTransitions(snapshot: AnyMachineSnapshot): TransitionInfo[];

  /** ガードで弾かれている遷移一覧 */
  blockedTransitions(snapshot: AnyMachineSnapshot): TransitionInfo[];

  /** 指定イベントがなぜ送れないかの説明文 */
  explainBlocked(snapshot: AnyMachineSnapshot, event: TEvent): string;

  /**
   * 現在有効な遷移ごとに「発火したら実行されるアクション名一覧」を返す。
   * エフェクト層で何が起きるかを確認するデバッグ・テスト用途向け。
   */
  commands(snapshot: AnyMachineSnapshot): CommandInfo[];
}

// AnyMachineSnapshot を Inspector 型内で参照するために再エクスポート
import type { AnyMachineSnapshot } from 'xstate';
export type { AnyMachineSnapshot };
