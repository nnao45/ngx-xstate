import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { noPayload, typedSetup } from '@zstate/core';
import { useActorRef } from './use-actor-ref';
import { useSelector } from './use-selector';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload },
}).createMachine({
  id: 'counter',
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
});

describe('useSelector', () => {
  it('derives a value and updates it when the slice changes (default shallowEqual)', () => {
    const { result } = renderHook(() => {
      const actor = useActorRef(counter);
      const slice = useSelector(actor, (s) => ({ count: s.context.count }));
      return { actor, slice };
    });

    expect(result.current.slice.count).toBe(0);
    act(() => {
      result.current.actor.send({ type: 'INC' });
    });
    expect(result.current.slice.count).toBe(1);
  });

  it('respects a custom compare function (always-equal freezes the value)', () => {
    const { result } = renderHook(() => {
      const actor = useActorRef(counter);
      const count = useSelector(
        actor,
        (s) => s.context.count,
        () => true,
      );
      return { actor, count };
    });

    expect(result.current.count).toBe(0);
    act(() => {
      result.current.actor.send({ type: 'INC' });
    });
    // compare が常に等価判定 → セレクタ結果は更新されない
    expect(result.current.count).toBe(0);
  });
});
