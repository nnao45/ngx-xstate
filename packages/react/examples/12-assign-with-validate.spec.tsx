/** 12: assignWithValidate — context スキーマで更新値を自動検証してからアサイン */
import { act, renderHook } from '@testing-library/react';
import { createActor } from 'xstate';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { assignWithValidate, noPayload, typedSetup, useActor } from '../src/public-api';

// strict: false (デフォルト) — 無効値は warn + no-op
const lenientForm = typedSetup({
  context: z.object({ email: z.string().email(), name: z.string() }),
  events: { SET_EMAIL: z.object({ value: z.string() }) },
}).createMachine({
  id: 'lenientForm',
  context: { email: 'a@b.com', name: 'Alice' },
  on: {
    // スキーマは typedSetup の context から自動取得。再宣言不要。
    SET_EMAIL: { actions: assignWithValidate(({ event }) => ({ email: event.value })) },
  },
});

// strict: true — 無効値で actor が error 状態に遷移
const strictCounter = typedSetup({
  context: z.object({ count: z.number().min(0) }),
  events: { DEC: noPayload },
  strict: true,
}).createMachine({
  id: 'strictCounter',
  context: { count: 0 },
  on: {
    // count を -1 にしようとするとスキーマ違反 → error 状態
    DEC: { actions: assignWithValidate({ count: ({ context }) => context.count - 1 }) },
  },
});

describe('12: assignWithValidate', () => {
  it('有効な更新は context に反映され、他フィールドは保持される', () => {
    const { result } = renderHook(() => useActor(lenientForm));
    act(() => {
      result.current.send({ type: 'SET_EMAIL', value: 'new@example.com' });
    });
    expect(result.current.snapshot.context.email).toBe('new@example.com');
    expect(result.current.snapshot.context.name).toBe('Alice'); // 変化なし
  });

  it('無効な値は warn + no-op（context 変更なし）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useActor(lenientForm));
    act(() => {
      result.current.send({ type: 'SET_EMAIL', value: 'not-an-email' });
    });
    expect(result.current.snapshot.context.email).toBe('a@b.com');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[@zstate/core] assignWithValidate'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('strict: true + 無効な更新で actor が error 状態になる', () => {
    // useActor の内部 subscribe が error ハンドラを持たないため、
    // strict テストは createActor を直接使って error 購読で抑制する。
    const errors: unknown[] = [];
    const actor = createActor(strictCounter);
    actor.subscribe({ error: (e) => errors.push(e) });
    actor.start();
    actor.send({ type: 'DEC' });
    expect(actor.getSnapshot().status).toBe('error');
    expect(errors).toHaveLength(1);
  });
});
