import type { z } from 'zod';

/**
 * イベント定義マップ。
 * key = イベント名、value = ペイロードの Zod スキーマ（payload あり）または null（payload なし）。
 */
export type EventsMap = Record<string, z.ZodObject<z.ZodRawShape> | null>;

/**
 * EventsMap から XState 用のイベント union 型を導出する。
 * - payload あり (ZodObject): `{ type: K } & z.infer<schema>`
 * - payload なし (null):      `{ type: K }`
 * - 空マップ:                  `{ type: string }`（イベント未定義 = 緩いイベント型）
 */
export type EventUnionFromMap<TEvents extends EventsMap> = [keyof TEvents] extends [never]
  ? { type: string }
  : {
      [K in keyof TEvents & string]: TEvents[K] extends z.ZodObject<z.ZodRawShape>
        ? { type: K } & z.infer<TEvents[K]>
        : { type: K };
    }[keyof TEvents & string];
