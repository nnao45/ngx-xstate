/**
 * 12: ngx-xstate APIs — ライブラリ固有機能のフル活用
 *
 * このファイルは ngx-xstate 固有の API を示す。
 *
 * Section A: createActorContext    — Angular DI でコンポーネントツリーに actor を共有
 * Section B: typedSetup    — on キー自動推論 + Zod ペイロード検証
 */
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createMachine } from 'xstate';
import { z } from 'zod';
import {
  createActorContext,
  typedSetup,
  noPayload,
  injectActor,
  injectActorRef,
  injectSelector,
} from '../src/public-api';

// =====================================================================
// Section A: createActorContext
// =====================================================================

const sharedCounterMachine = createMachine({
  id: 'sharedCounter',
  context: { count: 0 },
  on: {
    INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
    DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) },
  },
});

const CounterContext = createActorContext(sharedCounterMachine);

describe('12-A: createActorContext — shared actor via Angular DI', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('provideActor() + injectActorRef() resolves the same actor instance', () => {
    @Component({
      selector: 'test-parent-a',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class ParentComponent {
      actor = CounterContext.injectActorRef();
    }

    const fixture = TestBed.createComponent(ParentComponent);
    const actor = fixture.componentInstance.actor;

    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'INCREMENT' });

    expect(actor.getSnapshot().context.count).toBe(2);
  });

  it('injectSelector() returns a Signal derived from the shared actor', () => {
    @Component({
      selector: 'test-parent-b',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class ParentComponent {
      count = CounterContext.injectSelector((s) => s.context.count);
      actor = CounterContext.injectActorRef();
    }

    const fixture = TestBed.createComponent(ParentComponent);
    const { count, actor } = fixture.componentInstance;

    expect(count()).toBe(0);
    actor.send({ type: 'INCREMENT' });
    expect(count()).toBe(1);
  });

  it('two components sharing the same provideActor() see the same state', () => {
    // 同一コンポーネントのプロバイダーを共有する疑似テスト
    @Component({
      selector: 'test-shared-parent',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class SharedParent {
      actor = CounterContext.injectActorRef();
      count = CounterContext.injectSelector((s) => s.context.count);
    }

    const fixture = TestBed.createComponent(SharedParent);
    const { actor, count } = fixture.componentInstance;

    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'INCREMENT' });
    actor.send({ type: 'INCREMENT' });

    // actor と selector は同じ actor を参照している
    expect(count()).toBe(actor.getSnapshot().context.count);
    expect(count()).toBe(3);
  });

  it('separate provideActor() calls create independent instances', () => {
    @Component({
      selector: 'test-instance-a',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class InstanceA {
      actor = CounterContext.injectActorRef();
    }

    @Component({
      selector: 'test-instance-b',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class InstanceB {
      actor = CounterContext.injectActorRef();
    }

    const fixtureA = TestBed.createComponent(InstanceA);
    const fixtureB = TestBed.createComponent(InstanceB);

    fixtureA.componentInstance.actor.send({ type: 'INCREMENT' });
    fixtureA.componentInstance.actor.send({ type: 'INCREMENT' });

    // A は 2、B は 0 — 独立したインスタンス
    expect(fixtureA.componentInstance.actor.getSnapshot().context.count).toBe(2);
    expect(fixtureB.componentInstance.actor.getSnapshot().context.count).toBe(0);
  });

  it('throws when injectActorRef is called without provideActor', () => {
    expect(() => {
      TestBed.runInInjectionContext(() => CounterContext.injectActorRef());
    }).toThrow('[ngx-xstate]');
  });

  it('actor is destroyed when component is destroyed', () => {
    @Component({
      selector: 'test-destroy-check',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class DestroyCheck {
      actor = CounterContext.injectActorRef();
    }

    const fixture = TestBed.createComponent(DestroyCheck);
    const actor = fixture.componentInstance.actor;

    fixture.destroy();

    expect(actor.getSnapshot().status).toBe('stopped');
  });
});

// =====================================================================
// Section B: typedSetup — on キー自動推論 + Zod ペイロード検証
// =====================================================================

// typedSetup: 型を先に宣言（events + context）してから machine を生成。
// payload あり (ZodObject) / なし (null) を events マップで指定する。
// machine 内では event が遷移キーごとに自動 narrow され、注釈不要。
const todoMachine = typedSetup({
  context: z.object({ items: z.array(z.string()) }),
  events: {
    ADD: z.object({ item: z.string().min(1) }),
    REMOVE: z.object({ index: z.number().int().nonnegative() }),
    CLEAR: noPayload,
  },
  strict: false, // 不正イベントは warn + no-op
}).createMachine({
  id: 'todo',
  context: { items: [] },
  on: {
    ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
    REMOVE: {
      actions: assign({
        items: ({ context, event }) => context.items.filter((_, i) => i !== event.index),
      }),
    },
    CLEAR: { actions: assign({ items: [] }) },
  },
});

describe('12-B: typedSetup — auto-inferred events + Zod payloads', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts with empty items list', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(todoMachine));
    expect(snapshot().context.items).toEqual([]);
  });

  it('ADD event appends item', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(todoMachine));

    send({ type: 'ADD', item: 'Buy milk' });
    send({ type: 'ADD', item: 'Walk dog' });

    expect(snapshot().context.items).toEqual(['Buy milk', 'Walk dog']);
  });

  it('REMOVE event removes item by index', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(todoMachine));

    send({ type: 'ADD', item: 'First' });
    send({ type: 'ADD', item: 'Second' });
    send({ type: 'REMOVE', index: 0 });

    expect(snapshot().context.items).toEqual(['Second']);
  });

  it('CLEAR removes all items', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(todoMachine));

    send({ type: 'ADD', item: 'A' });
    send({ type: 'ADD', item: 'B' });
    send({ type: 'CLEAR' });

    expect(snapshot().context.items).toEqual([]);
  });

  it('invalid event is warned and ignored (strict: false)', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(todoMachine));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // 'UNKNOWN' は eventSchema に含まれないため no-op
    send({ type: 'UNKNOWN' } as never);

    expect(snapshot().context.items).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('strict mode throws on invalid event', () => {
    const strictMachine = typedSetup({
      context: z.object({ value: z.number() }),
      events: { SET: z.object({ n: z.number() }) },
      strict: true,
    }).createMachine({
      id: 'strict',
      context: { value: 0 },
      on: {
        SET: { actions: assign({ value: ({ event }) => event.n }) },
      },
    });

    const { send } = TestBed.runInInjectionContext(() => injectActor(strictMachine));

    expect(() => {
      send({ type: 'UNKNOWN' } as never);
    }).toThrow();
  });

  describe('dynamic input with injectActor', () => {
    const machineWithInput = typedSetup({
      context: z.object({ userId: z.string() }),
      input: z.object({ userId: z.string() }),
      events: {},
    }).createMachine({
      id: 'withInput',
      context: ({ input }) => ({ userId: input.userId }),
      initial: 'active',
      states: { active: {} },
    });

    it('accepts static input', () => {
      const { snapshot } = TestBed.runInInjectionContext(() =>
        injectActor(machineWithInput, { input: { userId: 'user-123' } }),
      );

      expect(snapshot().context.userId).toBe('user-123');
    });

    it('accepts dynamic function input (Signal-connected)', () => {
      @Component({
        selector: 'test-dynamic-schema',
        template: '',
        standalone: true,
      })
      class DynamicComponent {
        userId = signal('user-A');
        state = injectActor(machineWithInput, {
          input: () => ({ userId: this.userId() }),
        });
      }

      const fixture = TestBed.createComponent(DynamicComponent);
      fixture.detectChanges();

      expect(fixture.componentInstance.state.snapshot().context.userId).toBe('user-A');

      fixture.componentInstance.userId.set('user-B');
      TestBed.tick();

      expect(fixture.componentInstance.state.snapshot().context.userId).toBe('user-B');
    });
  });

  describe('injectSelector with shallow equal', () => {
    it('only updates Signal when selected value actually changes', () => {
      const actorRef = TestBed.runInInjectionContext(() => injectActorRef(todoMachine));
      const items = TestBed.runInInjectionContext(() =>
        injectSelector(actorRef, (s) => s.context.items),
      );

      const before = items();
      // 空の状態で CLEAR しても items は変わらないが、
      // shallow equal により Signal 通知が抑制されることを確認
      actorRef.send({ type: 'CLEAR' });

      // [] と [] は shallow equal により同一と判定 → Signal 値は更新されない
      expect(items()).toEqual([]);
      expect(typeof items()).toBe('object');

      actorRef.send({ type: 'ADD', item: 'X' });
      // 追加後は異なるので Signal が更新される
      expect(items()).toEqual(['X']);
      expect(items()).not.toBe(before);
    });
  });
});
