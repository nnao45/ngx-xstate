/**
 * 10: E2E — 注文フロー（全機能横断）
 *
 * useActor（snapshot/send/.in）+ useSelector + guard + 子 invoke の output +
 * XStateDevtoolsProvider を、実コンポーネント上で一気通貫に検証する。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign, type InspectionEvent } from 'xstate';
import { z } from 'zod';
import {
  noPayload,
  typedSetup,
  useActor,
  useSelector,
  XStateDevtoolsProvider,
} from '../src/public-api';

const payment = typedSetup({
  context: z.object({ orderId: z.string() }),
  input: z.object({ itemCount: z.number() }),
  output: z.object({ orderId: z.string() }),
  events: {},
}).createMachine({
  id: 'payment',
  context: ({ input }) => ({ orderId: `ORD-${String(input.itemCount)}` }),
  initial: 'charging',
  states: {
    charging: { always: { target: 'charged' } },
    charged: { type: 'final' },
  },
  output: ({ context }) => ({ orderId: context.orderId }),
});

const order = typedSetup({
  context: z.object({ items: z.array(z.string()), orderId: z.string().nullable() }),
  events: { ADD: z.object({ item: z.string().min(1) }), CHECKOUT: noPayload },
  actors: { payment },
  guards: { minItems: ({ context }, p: { min: number }) => context.items.length >= p.min },
}).createMachine({
  id: 'order',
  context: { items: [], orderId: null },
  initial: 'cart',
  states: {
    cart: {
      on: {
        ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
        CHECKOUT: { guard: { type: 'minItems', params: { min: 1 } }, target: 'paying' },
      },
    },
    paying: {
      invoke: {
        src: 'payment',
        input: ({ context }) => ({ itemCount: context.items.length }),
        onDone: {
          target: 'confirmed',
          actions: assign({ orderId: ({ event }) => event.output.orderId }),
        },
      },
    },
    confirmed: { type: 'final' },
  },
});

function OrderView() {
  const { snapshot, in: $in, actorRef } = useActor(order);
  const itemCount = useSelector(actorRef, (s) => s.context.items.length);

  return (
    <div>
      <span data-testid="state">{String(snapshot.value)}</span>
      <span data-testid="count">{itemCount}</span>
      <span data-testid="order">{snapshot.context.orderId ?? '-'}</span>
      <button type="button" onClick={() => $in('cart', (c) => c.send({ type: 'ADD', item: 'x' }))}>
        add
      </button>
      <button type="button" onClick={() => $in('cart', (c) => c.send({ type: 'CHECKOUT' }))}>
        checkout
      </button>
    </div>
  );
}

describe('10: E2E — order flow', () => {
  it('drives cart → payment → confirmed and captures the child output', async () => {
    const events: InspectionEvent[] = [];
    render(
      <XStateDevtoolsProvider inspector={{ inspect: (e) => events.push(e) }}>
        <OrderView />
      </XStateDevtoolsProvider>,
    );

    expect(screen.getByTestId('state').textContent).toBe('cart');

    // 0 件で checkout → guard で弾かれ cart のまま
    fireEvent.click(screen.getByText('checkout'));
    expect(screen.getByTestId('state').textContent).toBe('cart');

    fireEvent.click(screen.getByText('add'));
    fireEvent.click(screen.getByText('add'));
    expect(screen.getByTestId('count').textContent).toBe('2');

    fireEvent.click(screen.getByText('checkout'));
    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('confirmed');
    });
    // 子 payment machine の output.orderId が親 context に伝播
    expect(screen.getByTestId('order').textContent).toBe('ORD-2');

    // devtools が親 + 子の actor を補足
    const actorEvents = events.filter((e) => e.type === '@xstate.actor');
    expect(actorEvents.length).toBeGreaterThanOrEqual(2);
  });
});
