/**
 * 19: E2E — 注文フロー（全機能横断）
 *
 * 実コンポーネント上で ngx-xstate のほぼ全機能を一気通貫で検証する:
 * - typedSetup（context / events / input / output / actors / actions / guards / strict）
 * - 子 machine の invoke と onDone.event.output の型付き受け取り
 * - injectActor（Signal snapshot）+ injectSelector（派生 Signal）
 * - actor.in() による状態スコープ型安全 send（guard 越え）
 * - renderStateTree による現在状態スナップショット
 * - provideXstateDevtools が親子 actor を自動補足
 * - TestBed で実コンポーネントを描画し DOM とスナップショットを突き合わせ
 */
import { Component, computed, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, type InspectionEvent } from 'xstate';
import { z } from 'zod';
import {
  injectActor,
  injectSelector,
  matchActor,
  noPayload,
  provideXstateDevtools,
  renderStateTree,
  typedSetup,
} from '../src/public-api';

// ─── 子: 決済 machine（output で orderId を返す）─────────────────────────────
const paymentMachine = typedSetup({
  context: z.object({ orderId: z.string() }),
  input: z.object({ itemCount: z.number() }),
  output: z.object({ orderId: z.string() }),
  events: {},
}).createMachine({
  id: 'payment',
  context: ({ input }) => ({ orderId: `ORD-${String(input.itemCount)}` }),
  initial: 'charging',
  states: {
    charging: { always: { target: 'charged' } },
    charged: { type: 'final' },
  },
  output: ({ context }) => ({ orderId: context.orderId }),
});

// ─── 親: 注文 machine ────────────────────────────────────────────────────────
const orderMachine = typedSetup({
  context: z.object({
    items: z.array(z.string()),
    orderId: z.string().nullable(),
    error: z.string().nullable(),
  }),
  input: z.object({ initial: z.array(z.string()) }),
  events: {
    ADD: z.object({ item: z.string().min(1) }),
    CHECKOUT: noPayload,
  },
  actors: { payment: paymentMachine },
  // 名前付き action（params 型保持）
  actions: {
    setError: assign({ error: (_, params: { message: string }) => params.message }),
  },
  // 名前付き guard（params 型保持）
  guards: {
    minItems: ({ context }, params: { min: number }) => context.items.length >= params.min,
  },
}).createMachine({
  id: 'order',
  context: ({ input }) => ({ items: input.initial, orderId: null, error: null }),
  initial: 'cart',
  states: {
    cart: {
      on: {
        ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
        CHECKOUT: { guard: { type: 'minItems', params: { min: 1 } }, target: 'paying' },
      },
    },
    paying: {
      invoke: {
        src: 'payment',
        input: ({ context }) => ({ itemCount: context.items.length }),
        onDone: {
          target: 'confirmed',
          // event.output は payment の output 型に型付け
          actions: assign({ orderId: ({ event }) => event.output.orderId }),
        },
        onError: {
          target: 'cart',
          actions: { type: 'setError', params: { message: 'payment failed' } },
        },
      },
    },
    confirmed: { type: 'final' },
  },
});

@Component({
  selector: 'e2e-order',
  standalone: true,
  template: `
    <p class="state">{{ stateLabel() }}</p>
    <p class="count">{{ itemCount() }}</p>
    <p class="order">{{ orderId() ?? '-' }}</p>
  `,
})
class OrderComponent {
  readonly actor = injectActor(orderMachine, { input: { initial: [] } });
  readonly stateLabel = computed(() => JSON.stringify(this.actor.snapshot().value));
  readonly itemCount = injectSelector(this.actor.actorRef, (s) => s.context.items.length);
  readonly orderId = computed(() => this.actor.snapshot().context.orderId);

  add(item: string): void {
    // cart のときだけ ADD を送れる（型安全）
    this.actor.in('cart', (cart) => {
      cart.send({ type: 'ADD', item });
    });
  }

  checkout(): void {
    this.actor.in('cart', (cart) => {
      cart.send({ type: 'CHECKOUT' });
    });
  }
}

describe('19: E2E — order flow (all features)', () => {
  const events: InspectionEvent[] = [];

  beforeEach(() => {
    events.length = 0;
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
  });

  it('drives a full cart → payment → confirmed flow across the component', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    const el = fixture.nativeElement as HTMLElement;
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    // 初期: cart, 0 件
    expect(el.querySelector('.state')?.textContent).toContain('cart');
    expect(el.querySelector('.count')?.textContent).toBe('0');

    // 0件で CHECKOUT → guard(minItems>=1) で弾かれ cart のまま
    cmp.checkout();
    fixture.detectChanges();
    expect(cmp.actor.snapshot().value).toBe('cart');

    // 商品を追加（cart スコープからのみ送信可）
    cmp.add('apple');
    cmp.add('banana');
    fixture.detectChanges();
    expect(el.querySelector('.count')?.textContent).toBe('2');

    // CHECKOUT → paying → 子 invoke(always→final) → onDone → confirmed
    cmp.checkout();
    fixture.detectChanges();

    expect(cmp.actor.snapshot().value).toBe('confirmed');
    // 子 machine の output.orderId が親 context に伝播
    expect(cmp.actor.snapshot().context.orderId).toBe('ORD-2');
    expect(el.querySelector('.order')?.textContent).toBe('ORD-2');
  });

  it('renderStateTree reflects the live actor at each step', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    expect(renderStateTree(cmp.actor.actorRef)).toContain('cart ●');

    cmp.add('apple');
    cmp.checkout();
    fixture.detectChanges();

    const tree = renderStateTree(cmp.actor.actorRef);
    expect(tree).toContain('confirmed ●');
    expect(tree).toContain('cart  (initial)');
  });

  it('devtools inspector auto-captures both parent and child actors', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    cmp.add('apple');
    cmp.checkout(); // 子 payment actor が invoke される
    fixture.detectChanges();

    const actorEvents = events.filter((e) => e.type === '@xstate.actor');
    // 親 order + 子 payment の 2 つ以上の actor が補足される
    expect(actorEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('matchActor on the raw actorRef narrows send per state', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    let ran = '';
    matchActor(cmp.actor.actorRef)
      .in('cart', (cart) => {
        ran = 'cart';
        cart.send({ type: 'ADD', item: 'x' });
      })
      .in('confirmed', () => {
        ran = 'confirmed';
      });

    expect(ran).toBe('cart');
    expect(cmp.actor.snapshot().context.items).toEqual(['x']);
  });
});

// ─── strict モードのランタイム検証（throw）─────────────────────────────────────
const strictOrder = typedSetup({
  context: z.object({ items: z.array(z.string()) }),
  events: { ADD: z.object({ item: z.string().min(1) }) },
  strict: true,
}).createMachine({
  id: 'strictOrder',
  context: { items: [] },
  on: {
    ADD: { actions: assign({ items: ({ context, event }) => [...context.items, event.item] }) },
  },
});

describe('19b: E2E — strict Zod validation throws', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('throws on an invalid payload (empty item violates min(1))', () => {
    const { send } = TestBed.runInInjectionContext(() => injectActor(strictOrder));
    expect(() => {
      send({ type: 'ADD', item: '' });
    }).toThrow();
  });

  it('accepts a valid payload', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(strictOrder));
    send({ type: 'ADD', item: 'ok' });
    expect(snapshot().context.items).toEqual(['ok']);
  });
});
