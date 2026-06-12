import { createActor, type AnyStateMachine } from 'xstate';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { noPayload, typedSetup } from './typed-machine';
import { assignWithValidate } from './assign-with-validate';

// ─── テスト用 machine ──────────────────────────────────────────────────────────

const emailMachine = typedSetup({
  context: z.object({ email: z.string().email() }),
  events: { SET: z.object({ value: z.string() }) },
}).createMachine({
  context: { email: 'init@example.com' },
  on: {
    SET: { actions: assignWithValidate(({ event }) => ({ email: event.value })) },
  },
});

const strictEmailMachine = typedSetup({
  context: z.object({ email: z.string().email() }),
  events: { SET: z.object({ value: z.string() }) },
  strict: true,
}).createMachine({
  context: { email: 'init@example.com' },
  on: {
    SET: { actions: assignWithValidate(({ event }) => ({ email: event.value })) },
  },
});

// オブジェクト形式（PropertyAssigner）
const countMachine = typedSetup({
  context: z.object({ count: z.number().min(0), label: z.string() }),
  events: { INC: noPayload, SET: z.object({ value: z.number() }) },
}).createMachine({
  context: { count: 0, label: 'counter' },
  on: {
    INC: { actions: assignWithValidate({ count: ({ context }) => context.count + 1 }) },
    SET: { actions: assignWithValidate({ count: ({ event }) => event.value }) },
  },
});

function startWith(machine: AnyStateMachine) {
  const errors: unknown[] = [];
  const actor = createActor(machine);
  actor.subscribe({ error: (e) => errors.push(e) });
  actor.start();
  return { actor, errors };
}

// ─── 関数形式（Assigner） ────────────────────────────────────────────────────

describe('assignWithValidate – 関数形式', () => {
  it('有効な値は context に反映される', () => {
    const { actor } = startWith(emailMachine);
    actor.send({ type: 'SET', value: 'user@example.com' });
    expect(actor.getSnapshot().context.email).toBe('user@example.com');
  });

  it('無効な値 + デフォルト(strict: false) → warn + no-op', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { actor } = startWith(emailMachine);
    actor.send({ type: 'SET', value: 'bad' });
    expect(actor.getSnapshot().context.email).toBe('init@example.com');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[@zstate/core] assignWithValidate'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('無効な値 + strict: true → actor が error 状態になる', () => {
    const { actor, errors } = startWith(strictEmailMachine);
    actor.send({ type: 'SET', value: 'not-an-email' });
    expect(actor.getSnapshot().status).toBe('error');
    expect(errors).toHaveLength(1);
  });
});

// ─── オブジェクト形式（PropertyAssigner） ─────────────────────────────────────

describe('assignWithValidate – オブジェクト形式', () => {
  it('有効な値は context に反映される（partial: 指定外フィールドは保持）', () => {
    const { actor } = startWith(countMachine);
    actor.send({ type: 'INC' });
    expect(actor.getSnapshot().context).toEqual({ count: 1, label: 'counter' });
  });

  it('無効な値 → warn + no-op', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { actor } = startWith(countMachine);
    actor.send({ type: 'SET', value: -1 });
    expect(actor.getSnapshot().context['count']).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─── options.strict でアクション単位のオーバーライド ────────────────────────

describe('assignWithValidate – options.strict オーバーライド', () => {
  it('machine が strict: false でも options.strict: true を指定すれば error 状態になる', () => {
    const machine = typedSetup({
      context: z.object({ count: z.number().min(0) }),
      events: { SET: z.object({ value: z.number() }) },
      strict: false,
    }).createMachine({
      context: { count: 0 },
      on: {
        SET: {
          actions: assignWithValidate(
            { count: ({ event }) => event.value },
            { strict: true },
          ),
        },
      },
    });
    const { actor, errors } = startWith(machine);
    actor.send({ type: 'SET', value: -1 });
    expect(actor.getSnapshot().status).toBe('error');
    expect(errors).toHaveLength(1);
  });

  it('context スキーマ未定義なら検証スキップ（通常の assign と同じ）', () => {
    const machine = typedSetup({
      events: { SET: z.object({ value: z.number() }) },
    }).createMachine({
      context: { count: 0 },
      on: {
        SET: {
          actions: assignWithValidate({ count: ({ event }) => event.value }),
        },
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: 'SET', value: 99 });
    expect(actor.getSnapshot().context['count']).toBe(99);
  });
});
