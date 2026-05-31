import type { z } from 'zod';

/**
 * イベント定義マップ。
 * key = イベント名、value = ペイロードの Zod スキーマ。
 * ペイロードなしのイベントは空オブジェクト `z.object({})`（= `noPayload`）で表す。
 */
export type EventsMap = Record<string, z.ZodObject<z.ZodRawShape>>;

/**
 * EventsMap から XState 用のイベント union 型を導出する。
 * `{ type: K } & z.infer<schema>`。空スキーマ (`noPayload`) なら `{ type: K }` に畳まれる。
 * 空マップは `{ type: string }`（イベント未定義 = 緩いイベント型）。
 */
export type EventUnionFromMap<TEvents extends EventsMap> = [keyof TEvents] extends [never]
  ? { type: string }
  : {
      [K in keyof TEvents & string]: { type: K } & z.infer<TEvents[K]>;
    }[keyof TEvents & string];
