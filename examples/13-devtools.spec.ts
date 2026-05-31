/**
 * 13: Devtools — Stately Visualizer / カスタムロガー連携
 *
 * provideXstateDevtools() を app.config.ts に一度登録すると、
 * 以降の全 actor が自動でインスペクターに接続される。
 *
 * 本番 (isDevMode() === false) では自動で no-op になる。
 *
 * 実アプリでは @statelyai/inspect の createBrowserInspector() を渡す:
 *   provideXstateDevtools(createBrowserInspector())
 * ここではテスト用に { inspect } スタブを使う。
 */
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, type InspectionEvent } from 'xstate';
import { z } from 'zod';
import {
  createActorContext,
  createTypedMachine,
  injectActor,
  provideXstateDevtools,
} from '../src/public-api';

const counterMachine = createTypedMachine({
  context: z.object({ count: z.number() }),
  events: { INCREMENT: null },
}).create({
  id: 'devtoolsCounter',
  context: { count: 0 },
  on: {
    INCREMENT: {
      actions: assign({ count: ({ context }) => context.count + 1 }),
    },
  },
});

const CounterContext = createActorContext(counterMachine);

describe('13: Devtools', () => {
  beforeEach(() => {
    // beforeEach は使わず、各テストで inspector を差し替える
  });

  it('connects every injectActor() to the global inspector', () => {
    const events: InspectionEvent[] = [];

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideXstateDevtools({
          inspect: (e) => {
            events.push(e);
          },
        }),
      ],
    });

    const { send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));
    send({ type: 'INCREMENT' });

    // actor 起動 (@xstate.actor) と遷移 (@xstate.snapshot / @xstate.event) が記録される
    expect(events.some((e) => e.type === '@xstate.actor')).toBe(true);
    expect(events.some((e) => e.type === '@xstate.event')).toBe(true);
  });

  it('connects createActorContext actors too', () => {
    const events: InspectionEvent[] = [];

    @Component({
      selector: 'app-devtools-demo',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class DemoComponent {
      actor = CounterContext.injectActorRef();
    }

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideXstateDevtools({
          inspect: (e) => {
            events.push(e);
          },
        }),
      ],
    });

    TestBed.createComponent(DemoComponent);

    expect(events.some((e) => e.type === '@xstate.actor')).toBe(true);
  });

  it('per-actor inspect overrides the global inspector', () => {
    const globalEvents: InspectionEvent[] = [];
    const localEvents: InspectionEvent[] = [];

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideXstateDevtools({
          inspect: (e) => {
            globalEvents.push(e);
          },
        }),
      ],
    });

    TestBed.runInInjectionContext(() =>
      injectActor(counterMachine, {
        inspect: (e) => {
          localEvents.push(e);
        },
      }),
    );

    // この actor は per-actor inspect に流れ、global には流れない
    expect(localEvents.length).toBeGreaterThan(0);
    expect(globalEvents).toHaveLength(0);
  });

  it('works without devtools registered (inspector optional)', () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });

    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(counterMachine));
    send({ type: 'INCREMENT' });

    expect(snapshot().context.count).toBe(1);
  });
});
