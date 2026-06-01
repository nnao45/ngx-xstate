import type { Actor, AnyActorLogic } from 'xstate';

/**
 * send が受け付けるイベント型。typedSetup が生成する machine は
 * setup で完全に型付けされているため、machine 自身の send パラメータ型を使う。
 */
export type SendEvent<TLogic extends AnyActorLogic> = Parameters<Actor<TLogic>['send']>[0];
