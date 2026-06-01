/** 02: カウンター — payload 付きイベント + 型付き send */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { noPayload, typedSetup, useActor } from '../src/public-api';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload, ADD: z.object({ by: z.number() }) },
}).createMachine({
  id: 'counter',
  context: { count: 0 },
  on: {
    INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    ADD: { actions: assign({ count: ({ context, event }) => context.count + event.by }) },
  },
});

function Counter() {
  const { snapshot, send } = useActor(counter);
  return (
    <div>
      <span data-testid="count">{snapshot.context.count}</span>
      <button type="button" onClick={() => send({ type: 'INC' })}>
        inc
      </button>
      <button type="button" onClick={() => send({ type: 'ADD', by: 5 })}>
        add5
      </button>
    </div>
  );
}

describe('02: Counter', () => {
  it('increments and adds with a typed payload', () => {
    render(<Counter />);
    expect(screen.getByTestId('count').textContent).toBe('0');
    fireEvent.click(screen.getByText('inc'));
    expect(screen.getByTestId('count').textContent).toBe('1');
    fireEvent.click(screen.getByText('add5'));
    expect(screen.getByTestId('count').textContent).toBe('6');
  });
});
