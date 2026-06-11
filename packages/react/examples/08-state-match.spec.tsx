/** 08: 状態スコープ送信 — useActor().in と core の matchActor */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assign } from 'xstate';
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

const statusMachine = typedSetup({
  context: z.object({
    retries: z.number(),
    featureEnabled: z.boolean(),
    rawJson: z.string(),
  }),
  events: {
    FETCH: noPayload,
    RESOLVE: z.object({ rawJson: z.string() }),
    FAIL: noPayload,
  },
}).createMachine({
  id: 'status',
  context: { retries: 0, featureEnabled: true, rawJson: '{}' },
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: {
      on: {
        RESOLVE: { target: 'loaded', actions: assign({ rawJson: ({ event }) => event.rawJson }) },
        FAIL: { target: 'error', actions: assign({ retries: ({ context }) => context.retries + 1 }) },
      },
    },
    loaded: {},
    error: { on: { FETCH: 'loading' } },
  },
});

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

// ─── fold ─────────────────────────────────────────────────────────────────────

function StatusBadge() {
  const { actorRef } = useActor(statusMachine);
  const label = matchActor(actorRef).fold({
    idle: () => 'Ready',
    loading: () => 'Loading...',
    loaded: () => 'Done',
    _: () => 'Unknown',
  });
  return <span data-testid="badge">{label}</span>;
}

describe('fold — value-returning pattern match', () => {
  it('idle 時に "Ready" を表示する', () => {
    render(<StatusBadge />);
    expect(screen.getByTestId('badge').textContent).toBe('Ready');
  });

  it('FETCH 後に "Loading..." を表示する', () => {
    render(<StatusBadge />);
    // StatusBadge は send を持たないため別途 useActor を使う Driver を用意
    function Driver() {
      const { actorRef } = useActor(statusMachine);
      return (
        <button
          type="button"
          onClick={() => matchActor(actorRef).in('idle', (s) => s.send({ type: 'FETCH' }))}
        >
          fetch
        </button>
      );
    }

    // 同一 machine インスタンスを共有しないので、Driver+Badge を同じ tree にレンダリングする
    function App() {
      const { snapshot, actorRef } = useActor(statusMachine);
      const label = matchActor(actorRef).fold({
        idle: () => 'Ready',
        loading: () => 'Loading...',
        loaded: () => 'Done',
        _: () => 'Unknown',
      });
      return (
        <div>
          <span data-testid="fold-badge">{label}</span>
          <span data-testid="fold-state">{String(snapshot.value)}</span>
          <button
            type="button"
            onClick={() => matchActor(actorRef).in('idle', (s) => s.send({ type: 'FETCH' }))}
          >
            do-fetch
          </button>
        </div>
      );
    }

    const { unmount } = render(<App />);
    expect(screen.getByTestId('fold-badge').textContent).toBe('Ready');
    fireEvent.click(screen.getByText('do-fetch'));
    expect(screen.getByTestId('fold-badge').textContent).toBe('Loading...');
    unmount();
  });
});

// ─── zip ──────────────────────────────────────────────────────────────────────

function ZipApp() {
  const { actorRef } = useActor(statusMachine);
  const [label, cssClass] = matchActor(actorRef).zip(
    { idle: () => 'Ready', loading: () => 'Busy', loaded: () => 'Done', _: () => 'Unknown' },
    {
      idle: () => 'btn-primary',
      loading: () => 'btn-loading',
      loaded: () => 'btn-success',
      _: () => 'btn-secondary',
    },
  );
  return (
    <div>
      <span data-testid="zip-label">{label}</span>
      <span data-testid="zip-class">{cssClass}</span>
      <button
        type="button"
        onClick={() => matchActor(actorRef).in('idle', (s) => s.send({ type: 'FETCH' }))}
      >
        zip-fetch
      </button>
    </div>
  );
}

describe('zip — Apply.product: 2つのfoldを同時評価', () => {
  it('idle 時にラベルとCSSクラスが両方正しく反映される', () => {
    render(<ZipApp />);
    expect(screen.getByTestId('zip-label').textContent).toBe('Ready');
    expect(screen.getByTestId('zip-class').textContent).toBe('btn-primary');
  });

  it('loading 時にラベルとCSSクラスが両方正しく切り替わる', () => {
    render(<ZipApp />);
    fireEvent.click(screen.getByText('zip-fetch'));
    expect(screen.getByTestId('zip-label').textContent).toBe('Busy');
    expect(screen.getByTestId('zip-class').textContent).toBe('btn-loading');
  });
});

// ─── filter ───────────────────────────────────────────────────────────────────

function FilterApp({ featureEnabled }: { featureEnabled: boolean }) {
  const { actorRef } = useActor(
    typedSetup({
      context: z.object({
        retries: z.number(),
        featureEnabled: z.boolean(),
        rawJson: z.string(),
      }),
      events: {
        FETCH: noPayload,
        RESOLVE: z.object({ rawJson: z.string() }),
        FAIL: noPayload,
      },
    }).createMachine({
      id: `filter-status-${featureEnabled ? 'on' : 'off'}`,
      context: { retries: 0, featureEnabled, rawJson: '{}' },
      initial: 'idle',
      states: {
        idle: { on: { FETCH: 'loading' } },
        loading: {
          on: {
            RESOLVE: {
              target: 'loaded',
              actions: assign({ rawJson: ({ event }) => event.rawJson }),
            },
            FAIL: {
              target: 'error',
              actions: assign({ retries: ({ context }) => context.retries + 1 }),
            },
          },
        },
        loaded: {},
        error: { on: { FETCH: 'loading' } },
      },
    }),
  );

  const results: string[] = [];
  matchActor(actorRef)
    .filter((ctx) => ctx.featureEnabled)
    .in('idle', () => results.push('idle-handler'))
    .otherwise(() => results.push('otherwise'));

  return <span data-testid="filter-result">{results.join(',')}</span>;
}

describe('filter — FunctorFilter: feature flag ゲート', () => {
  it('featureEnabled=true の場合は idle で callback が実行される', () => {
    render(<FilterApp featureEnabled={true} />);
    expect(screen.getByTestId('filter-result').textContent).toBe('idle-handler');
  });

  it('featureEnabled=false の場合は state matching がスキップされ otherwise が実行される', () => {
    render(<FilterApp featureEnabled={false} />);
    expect(screen.getByTestId('filter-result').textContent).toBe('otherwise');
  });
});

// ─── attempt ──────────────────────────────────────────────────────────────────

function AttemptApp({ rawJson }: { rawJson: string }) {
  const { actorRef } = useActor(
    typedSetup({
      context: z.object({
        retries: z.number(),
        featureEnabled: z.boolean(),
        rawJson: z.string(),
      }),
      events: {
        FETCH: noPayload,
        RESOLVE: z.object({ rawJson: z.string() }),
        FAIL: noPayload,
      },
    }).createMachine({
      id: `attempt-status-${Math.random()}`,
      context: { retries: 0, featureEnabled: true, rawJson },
      initial: 'loaded',
      states: {
        idle: { on: { FETCH: 'loading' } },
        loading: {
          on: {
            RESOLVE: {
              target: 'loaded',
              actions: assign({ rawJson: ({ event }) => event.rawJson }),
            },
            FAIL: {
              target: 'error',
              actions: assign({ retries: ({ context }) => context.retries + 1 }),
            },
          },
        },
        loaded: {},
        error: { on: { FETCH: 'loading' } },
      },
    }),
  );

  const result = matchActor(actorRef).attempt({
    loaded: (s) => JSON.parse(s.context.rawJson) as unknown,
  });

  if (result.ok) {
    return (
      <span data-testid="attempt-result">{`ok:${String(result.ok)},value:${JSON.stringify(result.value)}`}</span>
    );
  }
  return (
    <span data-testid="attempt-result">{`ok:${String(result.ok)},error:${String(result.error)}`}</span>
  );
}

describe('attempt — IO.attempt: 例外を安全に捕捉', () => {
  it('正常JSONの場合 ok:true と value が返る', () => {
    render(<AttemptApp rawJson='{"key":"val"}' />);
    const text = screen.getByTestId('attempt-result').textContent ?? '';
    expect(text).toContain('ok:true');
    expect(text).toContain('"key"');
  });

  it('壊れたJSONの場合 ok:false と error が返る', () => {
    render(<AttemptApp rawJson="not-json" />);
    const text = screen.getByTestId('attempt-result').textContent ?? '';
    expect(text).toContain('ok:false');
    expect(text).toContain('error:');
  });
});

// ─── orElse ───────────────────────────────────────────────────────────────────

function OrElseApp() {
  const { actorRef } = useActor(statusMachine);
  const results: string[] = [];

  matchActor(actorRef)
    .in('loading', () => results.push('loading-branch'))
    .orElse(() =>
      matchActor(actorRef).in('idle', () => results.push('idle-fallback')),
    );

  return (
    <div>
      <span data-testid="orelse-result">{results.join(',')}</span>
      <button
        type="button"
        onClick={() => matchActor(actorRef).in('idle', (s) => s.send({ type: 'FETCH' }))}
      >
        orelse-fetch
      </button>
    </div>
  );
}

describe('orElse — Alternative: 未マッチ時フォールバック', () => {
  it('idle 状態では loading にマッチせず idle フォールバックが実行される', () => {
    render(<OrElseApp />);
    expect(screen.getByTestId('orelse-result').textContent).toBe('idle-fallback');
  });

  it('loading 状態では loading ブランチが実行され orElse は呼ばれない', () => {
    function OrElseLoadingApp() {
      const { actorRef } = useActor(statusMachine);
      const results: string[] = [];

      matchActor(actorRef)
        .in('loading', () => results.push('loading-branch'))
        .orElse(() =>
          matchActor(actorRef).in('idle', () => results.push('idle-fallback')),
        );

      return (
        <div>
          <span data-testid="orelse-loading-result">{results.join(',')}</span>
          <button
            type="button"
            onClick={() => matchActor(actorRef).in('idle', (s) => s.send({ type: 'FETCH' }))}
          >
            orelse-loading-fetch
          </button>
        </div>
      );
    }

    render(<OrElseLoadingApp />);
    // 最初は idle なので idle-fallback
    expect(screen.getByTestId('orelse-loading-result').textContent).toBe('idle-fallback');
    // FETCH して loading へ遷移すると loading-branch が実行される
    fireEvent.click(screen.getByText('orelse-loading-fetch'));
    expect(screen.getByTestId('orelse-loading-result').textContent).toBe('loading-branch');
  });
});
