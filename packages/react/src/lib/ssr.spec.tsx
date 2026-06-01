import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { noPayload, typedSetup } from '@zstate/core';
import { useActor } from './use-actor';
import { useSelector } from './use-selector';
import { useActorRef } from './use-actor-ref';

const counter = typedSetup({
  context: z.object({ count: z.number() }),
  events: { INC: noPayload },
}).createMachine({
  id: 'counter',
  context: { count: 7 },
  initial: 'idle',
  states: { idle: {} },
  on: { INC: {} },
});

describe('SSR (getServerSnapshot)', () => {
  it('renders the initial snapshot via useActor without throwing', () => {
    function App() {
      const { snapshot } = useActor(counter);
      return <span>count:{snapshot.context.count}</span>;
    }
    const html = renderToString(<App />);
    expect(html).toContain('count:');
    expect(html).toContain('7');
  });

  it('renders the initial selected value via useSelector without throwing', () => {
    function App() {
      const actor = useActorRef(counter);
      const count = useSelector(actor, (s) => s.context.count);
      return <span>count:{count}</span>;
    }
    const html = renderToString(<App />);
    expect(html).toContain('7');
  });
});
