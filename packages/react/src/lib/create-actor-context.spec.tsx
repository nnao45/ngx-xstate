import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { noPayload, typedSetup } from '@zstate/core';
import { createActorContext } from './create-actor-context';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  input: z.object({ start: z.number() }),
  events: { INC: noPayload },
}).createMachine({
  id: 'counter',
  context: ({ input }) => ({ count: input?.start ?? 0 }),
  on: { INC: { actions: assign({ count: ({ context }) => context.count + 1 }) } },
});

describe('createActorContext', () => {
  it('shares one actor across the subtree (child send reflected in parent selector)', () => {
    const Ctx = createActorContext(counter);

    function Inner() {
      const count = Ctx.useSelector((s) => s.context.count);
      const actor = Ctx.useActorRef();
      return (
        <>
          <span data-testid="count">{count}</span>
          <button type="button" onClick={() => actor.send({ type: 'INC' })}>
            inc
          </button>
        </>
      );
    }
    function App() {
      return (
        <Ctx.Provider>
          <Inner />
        </Ctx.Provider>
      );
    }

    render(<App />);
    expect(screen.getByTestId('count').textContent).toBe('0');
    act(() => {
      screen.getByText('inc').click();
    });
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('applies default options and per-Provider option override (input)', () => {
    const Ctx = createActorContext(counter, { input: { start: 10 } });
    function Inner() {
      const count = Ctx.useSelector((s) => s.context.count);
      return <span data-testid="count">{count}</span>;
    }

    render(
      <Ctx.Provider options={{ input: { start: 99 } }}>
        <Inner />
      </Ctx.Provider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('99');
  });

  it('supports a per-Provider logic override (same-typed machine)', () => {
    const Ctx = createActorContext(counter, { input: { start: 0 } });
    function Inner() {
      const count = Ctx.useSelector((s) => s.context.count);
      return <span data-testid="count">{count}</span>;
    }
    // logic prop に同型 machine を渡す（`props.logic ?? logic` の左辺ブランチ）
    render(
      <Ctx.Provider logic={counter} options={{ input: { start: 5 } }}>
        <Inner />
      </Ctx.Provider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('5');
  });

  it('throws when used outside its Provider', () => {
    const Ctx = createActorContext(counter);
    expect(() => renderHook(() => Ctx.useActorRef())).toThrow('[@zstate/react]');
  });
});
