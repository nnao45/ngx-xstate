/** 05: useSelector — 派生スライスだけを購読して再レンダーを絞る */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { typedSetup, useActorRef, useSelector } from '../src/public-api';

const cart = typedSetup({
  context: z.object({ items: z.array(z.string()), coupon: z.string() }),
  events: { ADD: z.object({ item: z.string() }), SET_COUPON: z.object({ code: z.string() }) },
}).createMachine({
  id: 'cart',
  context: { items: [], coupon: '' },
  on: {
    ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
    SET_COUPON: { actions: assign({ coupon: ({ event }) => event.code }) },
  },
});

function Cart() {
  const actor = useActorRef(cart);
  const count = useSelector(actor, (s) => s.context.items.length);
  return (
    <div>
      <span data-testid="count">{count}</span>
      <button type="button" onClick={() => actor.send({ type: 'ADD', item: 'x' })}>
        add
      </button>
      <button type="button" onClick={() => actor.send({ type: 'SET_COUPON', code: 'SALE' })}>
        coupon
      </button>
    </div>
  );
}

describe('05: useSelector', () => {
  it('reflects the selected slice as it changes', () => {
    render(<Cart />);
    expect(screen.getByTestId('count').textContent).toBe('0');
    fireEvent.click(screen.getByText('add'));
    fireEvent.click(screen.getByText('add'));
    expect(screen.getByTestId('count').textContent).toBe('2');
    // 別スライス（coupon）の変化では count は同じ
    fireEvent.click(screen.getByText('coupon'));
    expect(screen.getByTestId('count').textContent).toBe('2');
  });
});
