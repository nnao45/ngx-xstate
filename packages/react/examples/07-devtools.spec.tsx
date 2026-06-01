/** 07: devtools — XStateDevtoolsProvider が配下の全 actor を自動接続 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign, type InspectionEvent } from 'xstate';
import { z } from 'zod';
import { noPayload, typedSetup, useActor, XStateDevtoolsProvider } from '../src/public-api';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload },
}).createMachine({
  id: 'counter',
  context: { count: 0 },
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
});

function Counter() {
  const { snapshot, send } = useActor(counter);
  return (
    <button type="button" onClick={() => send({ type: 'INC' })}>
      {snapshot.context.count}
    </button>
  );
}

describe('07: devtools', () => {
  it('auto-connects every actor under the provider', () => {
    const events: InspectionEvent[] = [];
    render(
      <XStateDevtoolsProvider inspector={{ inspect: (e) => events.push(e) }}>
        <Counter />
      </XStateDevtoolsProvider>,
    );
    fireEvent.click(screen.getByRole('button'));

    expect(events.some((e) => e.type === '@xstate.actor')).toBe(true);
    expect(events.some((e) => e.type === '@xstate.event')).toBe(true);
  });
});
