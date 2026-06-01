/**
 * 20: E2E — リアルタイム系（並列 / 履歴 / 遅延 / spawn / DI 共有 横断）
 *
 * - parallel + ネスト compound + history + after(遅延)
 * - createActorContext で親子コンポーネント間に 1 つの actor を共有
 * - injectSelector で領域ごとの状態を購読
 * - matchActor で並列領域を個別にマッチ
 * - spawn で動的に子 actor を生成し、親 context が ActorRef を保持
 * - vi.useFakeTimers で遅延遷移を制御
 */
import { Component, computed, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, stopChild, type ActorRefFrom, type AnyActorRef } from 'xstate';
import { z } from 'zod';
import {
  createActorContext,
  injectActor,
  matchActor,
  noPayload,
  renderStateTree,
  typedSetup,
} from '../src/public-api';

// ─── メディアプレイヤー: parallel + 各領域 compound + 遅延 + history ──────────
const playerMachine = typedSetup({
  context: z.object({ overlayShownMs: z.number() }),
  events: {
    PLAY: noPayload,
    PAUSE: noPayload,
    MUTE: noPayload,
    UNMUTE: noPayload,
    SHOW_OVERLAY: noPayload,
    POWER_OFF: noPayload,
    POWER_ON: noPayload,
  },
}).createMachine({
  id: 'player',
  context: { overlayShownMs: 0 },
  initial: 'on',
  states: {
    on: {
      type: 'parallel',
      states: {
        playback: {
          initial: 'paused',
          states: {
            paused: { on: { PLAY: 'playing' } },
            playing: { on: { PAUSE: 'paused' } },
          },
        },
        volume: {
          initial: 'unmuted',
          states: {
            unmuted: { on: { MUTE: 'muted' } },
            muted: { on: { UNMUTE: 'unmuted' } },
          },
        },
        overlay: {
          initial: 'hidden',
          states: {
            hidden: { on: { SHOW_OVERLAY: 'visible' } },
            visible: { after: { 100: 'hidden' } },
            hist: { type: 'history' },
          },
        },
      },
      on: { POWER_OFF: 'off' },
    },
    off: { on: { POWER_ON: 'on.overlay.hist' } },
  },
});

const PlayerContext = createActorContext(playerMachine);

@Component({
  selector: 'e2e-player-controls',
  standalone: true,
  template: `<span class="pb">{{ playback() }}</span>`,
})
class ControlsComponent {
  private readonly actor = PlayerContext.injectActorRef();
  // 並列値はオブジェクトなので JSON 文字列で購読（テンプレート表示用）
  readonly playback = PlayerContext.injectSelector((s) => JSON.stringify(s.value));

  play(): void {
    matchActor(this.actor).within('on', (on) =>
      on.in('playback', () => {
        // 親領域 playback の現在子状態にかかわらず PLAY を送る
      }),
    );
    this.actor.send({ type: 'PLAY' });
  }
}

@Component({
  selector: 'e2e-player',
  standalone: true,
  imports: [ControlsComponent],
  providers: [PlayerContext.provideActor()],
  template: `
    <e2e-player-controls />
    <span class="snap">{{ label() }}</span>
  `,
})
class PlayerComponent {
  readonly actorRef = PlayerContext.injectActorRef();
  readonly snap = PlayerContext.injectSelector((s) => s.value);
  readonly label = computed(() => JSON.stringify(this.snap()));
}

// ─── spawn: ダウンロードマネージャ ───────────────────────────────────────────
const taskMachine = typedSetup({
  context: z.object({ progress: z.number() }),
  events: { TICK: noPayload },
}).createMachine({
  id: 'task',
  context: { progress: 0 },
  on: { TICK: { actions: assign({ progress: ({ context }) => context.progress + 10 }) } },
});
type TaskRef = ActorRefFrom<typeof taskMachine>;

const managerMachine = typedSetup({
  context: z.object({ tasks: z.custom<TaskRef[]>(() => true) }),
  events: { ADD_TASK: noPayload, TICK_ALL: noPayload, DROP_LAST: noPayload },
  actors: { task: taskMachine },
}).createMachine({
  id: 'manager',
  context: { tasks: [] },
  on: {
    ADD_TASK: {
      actions: assign({ tasks: ({ context, spawn }) => [...context.tasks, spawn('task')] }),
    },
    TICK_ALL: {
      actions: ({ context }) => {
        context.tasks.forEach((t) => {
          t.send({ type: 'TICK' });
        });
      },
    },
    DROP_LAST: {
      actions: [
        stopChild(({ context }) => context.tasks[context.tasks.length - 1] as AnyActorRef),
        assign({ tasks: ({ context }) => context.tasks.slice(0, -1) }),
      ],
    },
  },
});

function run<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

describe('20: E2E — realtime (parallel / history / delayed / DI share)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one actor across parent + child via createActorContext', () => {
    const fixture = TestBed.createComponent(PlayerComponent);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    // 子コンポーネントの操作が親の共有 actor に反映
    const controls = fixture.debugElement.children[0]?.componentInstance as ControlsComponent;
    controls.play();
    fixture.detectChanges();

    expect(el.querySelector('.pb')?.textContent).toContain('playing');
    expect(el.querySelector('.snap')?.textContent).toContain('playing');
  });

  it('advances independent parallel regions and a delayed overlay', () => {
    const fixture = TestBed.createComponent(PlayerComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    cmp.actorRef.send({ type: 'PLAY' });
    cmp.actorRef.send({ type: 'MUTE' });
    cmp.actorRef.send({ type: 'SHOW_OVERLAY' });

    expect(cmp.actorRef.getSnapshot().value).toEqual({
      on: { playback: 'playing', volume: 'muted', overlay: 'visible' },
    });

    // 遅延で overlay が自動的に hidden へ
    vi.advanceTimersByTime(100);
    expect(cmp.actorRef.getSnapshot().matches({ on: { overlay: 'hidden' } })).toBe(true);
    // 他領域は影響を受けない
    expect(cmp.actorRef.getSnapshot().matches({ on: { playback: 'playing' } })).toBe(true);
  });

  it('matchActor matches a parallel region and history restores it', () => {
    const fixture = TestBed.createComponent(PlayerComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    cmp.actorRef.send({ type: 'SHOW_OVERLAY' }); // overlay.visible

    // 並列領域 overlay を個別にマッチ
    let matched = false;
    matchActor(cmp.actorRef).within('on', (on) =>
      on.within('overlay', (overlay) =>
        overlay.in('visible', () => {
          matched = true;
        }),
      ),
    );
    expect(matched).toBe(true);

    // 電源 OFF → ON で history により overlay の状態が復帰
    cmp.actorRef.send({ type: 'POWER_OFF' });
    expect(cmp.actorRef.getSnapshot().value).toBe('off');
    cmp.actorRef.send({ type: 'POWER_ON' });
    expect(cmp.actorRef.getSnapshot().matches({ on: { overlay: 'visible' } })).toBe(true);

    // renderStateTree が並列状態にバッジを出す（on は (initial, parallel)）
    expect(renderStateTree(cmp.actorRef)).toContain('parallel');
  });

  it('spawns, forwards to, and stops dynamic child actors', () => {
    const { snapshot, send } = run(() => injectActor(managerMachine));

    send({ type: 'ADD_TASK' });
    send({ type: 'ADD_TASK' });
    send({ type: 'ADD_TASK' });
    expect(snapshot().context.tasks).toHaveLength(3);

    send({ type: 'TICK_ALL' });
    send({ type: 'TICK_ALL' });
    for (const t of snapshot().context.tasks) {
      expect(t.getSnapshot().context.progress).toBe(20);
    }

    send({ type: 'DROP_LAST' });
    expect(snapshot().context.tasks).toHaveLength(2);
  });
});
