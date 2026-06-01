/** 06: createActorContext — サブツリーで 1 つの actor を共有 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { createActorContext, noPayload, typedSetup } from '../src/public-api';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload },
}).createMachine({
  id: 'counter',
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
});

const CounterContext = createActorContext(counter);

function Display() {
  const count = CounterContext.useSelector((s) => s.context.count);
  return <span data-testid="count">{count}</span>;
}

function IncButton() {
  const actor = CounterContext.useActorRef();
  return (
    <button type="button" onClick={() => actor.send({ type: 'INC' })}>
      inc
    </button>
  );
}

function Page() {
  return (
    <CounterContext.Provider>
      <Display />
      <IncButton />
    </CounterContext.Provider>
  );
}

describe('06: createActorContext', () => {
  it('shares one actor between sibling components', () => {
    render(<Page />);
    expect(screen.getByTestId('count').textContent).toBe('0');
    fireEvent.click(screen.getByText('inc'));
    expect(screen.getByTestId('count').textContent).toBe('1');
  });
});
