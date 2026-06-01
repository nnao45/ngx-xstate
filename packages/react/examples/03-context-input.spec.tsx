/** 03: input — props から machine の初期 context を組む（静的 input） */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { noPayload, typedSetup, useActor } from '../src/public-api';

const greeter = typedSetup({
  context: z.object({ name: z.string() }),
  input: z.object({ name: z.string() }),
  events: { RESET: noPayload },
}).createMachine({
  id: 'greeter',
  context: ({ input }) => ({ name: input.name }),
  initial: 'ready',
  states: { ready: {} },
});

function Greeter({ name }: { name: string }) {
  const { snapshot } = useActor(greeter, { input: { name } });
  return <span data-testid="hello">Hello, {snapshot.context.name}</span>;
}

describe('03: input', () => {
  it('captures input at creation', () => {
    render(<Greeter name="Ada" />);
    expect(screen.getByTestId('hello').textContent).toBe('Hello, Ada');
  });
});
