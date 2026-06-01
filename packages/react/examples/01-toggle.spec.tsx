/** 01: トグル — useActor の最小例 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { noPayload, typedSetup, useActor } from '../src/public-api';

const toggle = typedSetup({
  events: { TOGGLE: noPayload },
}).createMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: { on: { TOGGLE: 'active' } },
    active: { on: { TOGGLE: 'inactive' } },
  },
});

function Toggle() {
  const { snapshot, send } = useActor(toggle);
  return (
    <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
      {snapshot.matches('active') ? 'ON' : 'OFF'}
    </button>
  );
}

describe('01: Toggle', () => {
  it('flips between ON and OFF on click', () => {
    render(<Toggle />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('OFF');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('ON');
    fireEvent.click(btn);
    expect(btn.textContent).toBe('OFF');
  });
});
