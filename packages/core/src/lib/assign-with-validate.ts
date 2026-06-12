import { assign } from 'xstate';
import type {
  ActionFunction,
  AnyActorLogic,
  AnyEventObject,
  AssignArgs,
  Assigner,
  EventObject,
  MachineContext,
  ParameterizedObject,
  PropertyAssigner,
  ProvidedActor,
} from 'xstate';
import { getSchemas } from './schemas';

function evaluateAssignment<
  TContext extends MachineContext,
  TExpressionEvent extends EventObject,
  TParams extends ParameterizedObject['params'] | undefined,
  TEvent extends EventObject,
  TActor extends ProvidedActor,
>(
  assignment:
    | Assigner<TContext, TExpressionEvent, TParams, TEvent, TActor>
    | PropertyAssigner<TContext, TExpressionEvent, TParams, TEvent, TActor>,
  args: AssignArgs<TContext, TExpressionEvent, TEvent, TActor>,
  params: TParams,
): Partial<TContext> {
  if (typeof assignment === 'function') {
    return assignment(args, params);
  }
  const result: Partial<TContext> = {};
  for (const key of Object.keys(assignment) as Array<keyof TContext & string>) {
    const val = assignment[key];
    if (typeof val === 'function') {
      (result as Record<string, unknown>)[key] = (
        val as (
          args: AssignArgs<TContext, TExpressionEvent, TEvent, TActor>,
          params: TParams,
        ) => TContext[typeof key]
      )(args, params);
    } else if (val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

/**
 * `assign` と同様に context を更新するが、更新後の context 値を
 * `typedSetup` の `context` スキーマで自動検証してから適用する。
 *
 * スキーマは machine に付与済みのものを実行時に取得するため、
 * 呼び出し側での再宣言は不要。
 *
 * - 検証成功 → context に適用（通常の assign と同じ）
 * - 検証失敗 + `strict: true` → ZodError を throw（actor が error 状態に遷移）
 * - 検証失敗 + `strict: false`（デフォルト）→ warn して no-op（context 変更なし）
 * - context スキーマ未定義 → 検証スキップ（通常の assign と同じ）
 *
 * `strict` 未指定時は `typedSetup({ strict })` の値を引き継ぐ。
 *
 * @example
 * // 関数形式
 * assignWithValidate(({ event }) => ({ email: event.value }), { strict: true })
 *
 * @example
 * // オブジェクト形式（machineのcontextスキーマで検証）
 * assignWithValidate({ count: ({ context }) => context.count + 1 })
 */
export function assignWithValidate<
  TContext extends MachineContext,
  TExpressionEvent extends AnyEventObject,
  TParams extends ParameterizedObject['params'] | undefined = undefined,
  TEvent extends EventObject = AnyEventObject,
  TActor extends ProvidedActor = ProvidedActor,
>(
  assignment:
    | Assigner<TContext, TExpressionEvent, TParams, TEvent, TActor>
    | PropertyAssigner<TContext, TExpressionEvent, TParams, TEvent, TActor>,
  options?: { strict?: boolean },
): ActionFunction<TContext, TExpressionEvent, TEvent, TParams, TActor, never, never, never, never> {
  return assign(
    (args: AssignArgs<TContext, TExpressionEvent, TEvent, TActor>, params: TParams) => {
      const candidate = evaluateAssignment(assignment, args, params);

      const logic = (args.self as unknown as { logic?: AnyActorLogic }).logic;
      const schemas = logic ? getSchemas(logic) : undefined;

      if (schemas?.context == null) {
        return candidate;
      }

      // 現在の context に candidate をマージした結果を検証する
      const merged = { ...args.context, ...candidate };
      const result = schemas.context.safeParse(merged);

      if (!result.success) {
        const strict = options?.strict ?? schemas.strict;
        if (strict) {
          throw result.error;
        }
        console.warn(
          '[@zstate/core] assignWithValidate: invalid context update:',
          result.error.format(),
        );
        return args.context;
      }

      return candidate;
    },
  );
}
