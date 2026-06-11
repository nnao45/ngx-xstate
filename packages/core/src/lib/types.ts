import type { Actor, AnyActorLogic, createActor } from 'xstate';

/**
 * send が受け付けるイベント型。typedSetup が生成する machine は
 * setup で完全に型付けされているため、machine 自身の send パラメータ型を使う。
 */
export type SendEvent<TLogic extends AnyActorLogic> = Parameters<Actor<TLogic>['send']>[0];

/**
 * actor logic の input 型を抽出するユーティリティ型。
 * `createActor<TLogic>(logic, options)` の options.input の型を返す。
 * input が不要な logic では `undefined` になる。
 *
 * @example
 * const machine = typedSetup({ input: z.object({ userId: z.string() }), ... }).createMachine({...});
 * type I = InputFrom<typeof machine>; // { userId: string }
 */
export type InputFrom<TLogic extends AnyActorLogic> = Parameters<
  typeof createActor<TLogic>
>[1] extends { input?: infer I }
  ? I
  : never;
