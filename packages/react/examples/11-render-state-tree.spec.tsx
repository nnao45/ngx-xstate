/** 11: renderStateTree — 実行中 actor の現在状態を ASCII ツリーで可視化 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { noPayload, renderStateTree, typedSetup, useActorRef } from '../src/public-api';

const checkout = typedSetup({
  events: { PAY: noPayload, CONFIRM: noPayload },
}).createMachine({
  id: 'checkout',
  initial: 'cart',
  states: {
    cart: { on: { PAY: 'paying' } },
    paying: {
      initial: 'entering',
      states: { entering: { on: { CONFIRM: 'confirming' } }, confirming: {} },
      on: {},
    },
    done: { type: 'final' },
  },
});

describe('11: renderStateTree', () => {
  it('marks the active states of a running actor', () => {
    const { result } = renderHook(() => useActorRef(checkout));
    const tree = renderStateTree(result.current);
    expect(tree).toContain('checkout ●');
    expect(tree).toContain('cart');
    expect(tree).toContain('(initial)');
  });
});
