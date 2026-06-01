/** 04: 非同期 invoke — fromPromise + onDone で context 更新 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign, fromPromise } from 'xstate';
import { z } from 'zod';
import { noPayload, typedSetup, useActor } from '../src/public-api';

const loader = typedSetup({
  context: z.object({ data: z.string() }),
  events: { FETCH: noPayload },
  actors: {
    load: fromPromise(() => Promise.resolve('loaded')),
  },
}).createMachine({
  id: 'loader',
  context: { data: '' },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: {
      invoke: {
        src: 'load',
        onDone: { target: 'done', actions: assign({ data: ({ event }) => event.output }) },
      },
    },
    done: {},
  },
});

function Loader() {
  const { snapshot, send } = useActor(loader);
  return (
    <div>
      <span data-testid="state">{String(snapshot.value)}</span>
      <span data-testid="data">{snapshot.context.data}</span>
      <button type="button" onClick={() => send({ type: 'FETCH' })}>
        fetch
      </button>
    </div>
  );
}

describe('04: async invoke', () => {
  it('resolves the promise actor and stores its output', async () => {
    render(<Loader />);
    fireEvent.click(screen.getByText('fetch'));
    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('done');
    });
    expect(screen.getByTestId('data').textContent).toBe('loaded');
  });
});
