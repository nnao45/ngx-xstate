import type { Actor, AnyActorLogic } from 'xstate';
import type { SchemasPayload } from './schemas';

/**
 * イベントを Zod スキーマで検証してから actor に送る（framework 非依存）。
 *
 * - スキーマ無し → 素通しで送る
 * - 検証失敗 + `strict: true` → throw
 * - 検証失敗 + `strict: false`（デフォルト）→ warn して no-op（XState の未知イベント無視に倣う）
 */
export function validateAndSend<TLogic extends AnyActorLogic>(
  actor: Actor<TLogic>,
  event: Parameters<Actor<TLogic>['send']>[0],
  schemas: SchemasPayload | undefined,
): void {
  if (schemas?.events != null) {
    const result = schemas.events.safeParse(event);
    if (!result.success) {
      if (schemas.strict) {
        throw result.error;
      } else {
        console.warn('[@zstate/core] Invalid event:', result.error.format());
        return;
      }
    }
  }
  actor.send(event);
}
