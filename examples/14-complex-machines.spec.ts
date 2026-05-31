/**
 * 14: 複雑な複数ステートマシン協調
 *
 * ngx-xstate (typedSetup + injectActor) が実用規模の machine でも
 * 正しく動くことを実証する。
 *
 * A) invoke で子 machine を起動し output を親が受け取る
 * B) spawn で子 actor を動的生成し、親 context が ActorRef を保持
 * C) parallel + ネスト compound + history + after + guard + final の全部入り
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, stopChild, type ActorRefFrom, type AnyActorRef } from 'xstate';
import { z } from 'zod';
import { typedSetup, injectActor, noPayload } from '../src/public-api';

function run<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

// =====================================================================
// A) invoke で子 machine を起動し、final state の output を親が受け取る
// =====================================================================

// 子: input から jobId を受け取り、working → done と遷移し output を返す。
const workerMachine = typedSetup({
  context: z.object({ jobId: z.string() }),
  input: z.object({ jobId: z.string() }),
  events: {},
}).createMachine({
  id: 'worker',
  context: ({ input }) => ({ jobId: input.jobId }),
  initial: 'working',
  states: {
    working: { always: { target: 'done' } }, // eventless 遷移で即完了
    done: { type: 'final' },
  },
  output: ({ context }) => ({ jobId: context.jobId }),
});

const managerMachine = typedSetup({
  context: z.object({ completed: z.array(z.string()) }),
  events: { START: noPayload },
  actors: { worker: workerMachine },
}).createMachine({
  id: 'manager',
  context: { completed: [] },
  initial: 'idle',
  states: {
    idle: { on: { START: 'running' } },
    running: {
      invoke: {
        src: 'worker',
        input: { jobId: 'job-42' },
        onDone: {
          target: 'finished',
          // event.output は worker の output 型に型付けされる
          actions: assign({
            completed: ({ context, event }) => [...context.completed, event.output.jobId],
          }),
        },
      },
    },
    finished: { type: 'final' },
  },
});

// =====================================================================
// B) spawn で子 actor を動的生成、親 context が ActorRef 配列を保持
// =====================================================================

const counterChild = typedSetup({
  context: z.object({ n: z.number() }),
  events: { INC: noPayload },
}).createMachine({
  id: 'counterChild',
  context: { n: 0 },
  on: { INC: { actions: assign({ n: ({ context }) => context.n + 1 }) } },
});

type CounterChildRef = ActorRefFrom<typeof counterChild>;

const spawnerMachine = typedSetup({
  // ActorRef は Zod では検証できないので z.custom で型だけ付ける
  context: z.object({ children: z.custom<CounterChildRef[]>(() => true) }),
  events: { SPAWN: noPayload, INC_ALL: noPayload, STOP_LAST: noPayload },
  actors: { counterChild },
}).createMachine({
  id: 'spawner',
  context: { children: [] },
  on: {
    SPAWN: {
      actions: assign({
        children: ({ context, spawn }) => [...context.children, spawn('counterChild')],
      }),
    },
    INC_ALL: {
      actions: ({ context }) => {
        context.children.forEach((child) => {
          child.send({ type: 'INC' });
        });
      },
    },
    STOP_LAST: {
      actions: [
        stopChild(({ context }) => context.children.at(-1) as AnyActorRef),
        assign({ children: ({ context }) => context.children.slice(0, -1) }),
      ],
    },
  },
});

// =====================================================================
// C) parallel + ネスト compound + history + after + guard + final 全部入り
// =====================================================================

const trafficSystemMachine = typedSetup({
  context: z.object({ pedestrianWaiting: z.boolean() }),
  events: {
    PED_BUTTON: noPayload,
    POWER_OFF: noPayload,
    POWER_ON: noPayload,
    NEXT: noPayload,
  },
}).createMachine({
  id: 'trafficSystem',
  initial: 'on',
  context: { pedestrianWaiting: false },
  states: {
    on: {
      type: 'parallel',
      states: {
        // 領域1: 車用信号（compound + delayed）
        vehicle: {
          initial: 'green',
          states: {
            green: { after: { 30: 'yellow' }, on: { NEXT: 'yellow' } },
            yellow: { after: { 10: 'red' }, on: { NEXT: 'red' } },
            red: { after: { 30: 'green' }, on: { NEXT: 'green' } },
          },
        },
        // 領域2: 歩行者（guard + history）
        pedestrian: {
          initial: 'dontWalk',
          states: {
            dontWalk: {
              on: {
                PED_BUTTON: {
                  target: 'walk',
                  guard: ({ context }) => !context.pedestrianWaiting,
                  actions: assign({ pedestrianWaiting: true }),
                },
              },
            },
            walk: {
              after: { 50: 'dontWalk' },
              exit: assign({ pedestrianWaiting: false }),
            },
            hist: { type: 'history' },
          },
        },
      },
      on: { POWER_OFF: 'off' },
    },
    // 電源OFF → ONで history により元の歩行者状態へ復帰
    off: {
      on: { POWER_ON: 'on.pedestrian.hist' },
    },
  },
});

describe('14: Complex multi-machine coordination', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('A) invoke child machine → output propagation', () => {
    it('parent receives child final output', () => {
      const { snapshot, send } = run(() => injectActor(managerMachine));

      // 子は always 遷移で即 done → 親の onDone が同期的に発火
      send({ type: 'START' });

      expect(snapshot().value).toBe('finished');
      expect(snapshot().context.completed).toEqual(['job-42']);
    });
  });

  describe('B) spawn dynamic child actors', () => {
    it('spawns children and forwards events to all', () => {
      const { snapshot, send } = run(() => injectActor(spawnerMachine));

      send({ type: 'SPAWN' });
      send({ type: 'SPAWN' });
      expect(snapshot().context.children).toHaveLength(2);

      // 全子に INC を送る
      send({ type: 'INC_ALL' });
      send({ type: 'INC_ALL' });

      for (const child of snapshot().context.children) {
        expect(child.getSnapshot().context.n).toBe(2);
      }
    });

    it('stops and removes the last spawned child', () => {
      const { snapshot, send } = run(() => injectActor(spawnerMachine));

      send({ type: 'SPAWN' });
      send({ type: 'SPAWN' });
      send({ type: 'STOP_LAST' });

      expect(snapshot().context.children).toHaveLength(1);
    });
  });

  describe('C) parallel + nested + history + after + guard + final', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts with both regions in initial state', () => {
      const { snapshot } = run(() => injectActor(trafficSystemMachine));
      expect(snapshot().value).toEqual({
        on: { vehicle: 'green', pedestrian: 'dontWalk' },
      });
    });

    it('vehicle region advances independently via delayed transitions', () => {
      const { snapshot } = run(() => injectActor(trafficSystemMachine));

      vi.advanceTimersByTime(30);
      expect(snapshot().matches({ on: { vehicle: 'yellow' } })).toBe(true);

      vi.advanceTimersByTime(10);
      expect(snapshot().matches({ on: { vehicle: 'red' } })).toBe(true);
    });

    it('pedestrian guard blocks re-entry while already waiting', () => {
      const { snapshot, send } = run(() => injectActor(trafficSystemMachine));

      send({ type: 'PED_BUTTON' });
      expect(snapshot().matches({ on: { pedestrian: 'walk' } })).toBe(true);
      expect(snapshot().context.pedestrianWaiting).toBe(true);

      // walk 中の PED_BUTTON は guard で弾かれる（dontWalk の遷移のみ）
      send({ type: 'PED_BUTTON' });
      expect(snapshot().matches({ on: { pedestrian: 'walk' } })).toBe(true);
    });

    it('history restores pedestrian sub-state after power cycle', () => {
      const { snapshot, send } = run(() => injectActor(trafficSystemMachine));

      send({ type: 'PED_BUTTON' }); // pedestrian → walk
      expect(snapshot().matches({ on: { pedestrian: 'walk' } })).toBe(true);

      send({ type: 'POWER_OFF' });
      expect(snapshot().value).toBe('off');

      send({ type: 'POWER_ON' }); // history で walk に復帰
      expect(snapshot().matches({ on: { pedestrian: 'walk' } })).toBe(true);
    });
  });
});
