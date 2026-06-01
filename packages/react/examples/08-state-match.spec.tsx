/** 08: 状態スコープ送信 — useActor().in と core の matchActor */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { matchActor, noPayload, typedSetup, useActor } from '../src/public-api';

const fetchMachine = typedSetup({
  context: z.object({ retries: z.number() }),
  events: { FETCH: noPayload, RESOLVE: noPayload, CANCEL: noPayload },
}).createMachine({
  id: 'fetch',
  context: { retries: 0 },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: { on: { RESOLVE: 'success', CANCEL: 'idle' } },
    success: {},
  },
});

function Fetcher() {
  const { snapshot, in: $in, actorRef } = useActor(fetchMachine);

  // 現在状態でしか送れないイベントだけを型安全に dispatch する
  const primaryAction = () => {
    $in('idle', (idle) => idle.send({ type: 'FETCH' })).in('loading', (loading) =>
      loading.send({ type: 'RESOLVE' }),
    );
  };

  return (
    <div>
      <span data-testid="state">{String(snapshot.value)}</span>
      <button type="button" onClick={primaryAction}>
        primary
      </button>
      <button
        type="button"
        onClick={() => matchActor(actorRef).in('loading', (l) => l.send({ type: 'CANCEL' }))}
      >
        cancel
      </button>
    </div>
  );
}

describe('08: state-scoped dispatch', () => {
  it('dispatches the event valid in the current state', () => {
    render(<Fetcher />);
    expect(screen.getByTestId('state').textContent).toBe('idle');

    fireEvent.click(screen.getByText('primary')); // idle → FETCH → loading
    expect(screen.getByTestId('state').textContent).toBe('loading');

    fireEvent.click(screen.getByText('primary')); // loading → RESOLVE → success
    expect(screen.getByTestId('state').textContent).toBe('success');
  });

  it('matchActor on the raw actorRef narrows send per state', () => {
    render(<Fetcher />);
    fireEvent.click(screen.getByText('primary')); // → loading
    fireEvent.click(screen.getByText('cancel')); // matchActor: loading → CANCEL → idle
    expect(screen.getByTestId('state').textContent).toBe('idle');
  });
});
