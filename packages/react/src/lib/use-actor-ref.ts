import { useCallback, useEffect, useRef, useState } from 'react';
import { createActor, type Actor, type AnyActorLogic, type InspectionEvent } from 'xstate';
import { getSchemas, type SchemasPayload } from '@zstate/core';
import { useDevtoolsInspect } from './devtools';
import type { UseActorOptions } from './types';

export function buildActorOptions<TLogic extends AnyActorLogic>(
  options: UseActorOptions<TLogic> | undefined,
  input: unknown,
  globalInspect?: (event: InspectionEvent) => void,
): Parameters<typeof createActor<TLogic>>[1] {
  // Per-actor inspect takes precedence over the global devtools inspector.
  const inspect = options?.inspect ?? globalInspect;
  return {
    id: options?.id,
    systemId: options?.systemId,
    inspect,
    input,
    snapshot: options?.snapshot,
  } as Parameters<typeof createActor<TLogic>>[1];
}

function validateInput(input: unknown, schemas: SchemasPayload | undefined): void {
  if (schemas?.input == null || input == null) return;

  const result = schemas.input.safeParse(input);
  if (!result.success) {
    if (schemas.strict) {
      throw result.error;
    } else {
      console.warn('[@zstate/react] Invalid input:', result.error.format());
    }
  }
}

/**
 * machine から actor を生成・開始し、アンマウントで停止する。
 * `input` は生成時に1度だけ捕捉・検証される（静的）。
 *
 * XState v5 の actor は一度 `stop()` すると再 `start()` できないため、StrictMode の
 * mount→unmount→mount で死んだ actor を掴まないよう、停止済みを検知したら新しい
 * actor を作り直す（dev のみ発火。本番の単一マウントでは生成・開始は各1回）。
 */
export function useActorRef<TLogic extends AnyActorLogic>(
  logic: TLogic,
  options?: UseActorOptions<TLogic>,
): Actor<TLogic> {
  const globalInspect = useDevtoolsInspect();

  // 生成パラメータは ref 経由で参照（再生成時に最新の logic/options を使う）。
  const paramsRef = useRef({ logic, options, globalInspect });
  paramsRef.current = { logic, options, globalInspect };

  const create = useCallback((): Actor<TLogic> => {
    const params = paramsRef.current;
    const schemas = getSchemas(params.logic);
    validateInput(params.options?.input, schemas);
    return createActor(
      params.logic,
      buildActorOptions(params.options, params.options?.input as unknown, params.globalInspect),
    );
  }, []);

  const [actorRef, setActorRef] = useState<Actor<TLogic>>(create);

  useEffect(() => {
    // 停止済み actor（StrictMode の再マウント）は再起動できないので作り直す。
    const status = (actorRef.getSnapshot() as { status: string }).status;
    if (status === 'stopped') {
      setActorRef(create());
      return undefined;
    }
    actorRef.start();
    return () => {
      actorRef.stop();
    };
  }, [actorRef, create]);

  return actorRef;
}
