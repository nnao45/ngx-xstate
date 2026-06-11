/**
 * injectActor / InjectActorOptions の input コンパイル時型安全性テスト
 *
 * このファイルは「型が正しく制約されていること」を実行時テストで証明する。
 * vitest の `expectTypeOf` + `@ts-expect-error` コメントで型エラーを明示し、
 * 複雑な Zod スキーマ・ネスト・ユニオン・Discriminated Union でも
 * 型推論がエレガントに機能することを確認する。
 */
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { assign, createMachine } from 'xstate';
import { z } from 'zod';
import { typedSetup, noPayload, type InputFrom } from '@zstate/core';
import { injectActor } from './inject-actor';
import type { InjectActorOptions } from './types';

// ─── テスト用 machine 定義 ───────────────────────────────────────────────────

/** 1) input なし machine（最もシンプル） */
const noInputMachine = createMachine({
  id: 'noInput',
  initial: 'idle',
  context: { count: 0 },
  states: { idle: {} },
});

/** 2) プリミティブ input（number） */
const numberInputMachine = typedSetup({
  events: {},
  input: z.object({ initialCount: z.number() }),
  context: z.object({ count: z.number() }),
}).createMachine({
  id: 'numberInput',
  context: ({ input }) => ({ count: input.initialCount }),
  initial: 'idle',
  states: { idle: {} },
});

/** 3) ネストした複雑なオブジェクト input */
const deepNestedInputMachine = typedSetup({
  events: { FETCH: noPayload, RESET: noPayload },
  input: z.object({
    user: z.object({
      id: z.string().uuid(),
      profile: z.object({
        name: z.string().min(1),
        age: z.number().int().min(0).max(150),
        tags: z.array(z.string()),
      }),
    }),
    config: z.object({
      maxRetries: z.number().int().positive(),
      timeout: z.number().positive(),
    }),
  }),
  context: z.object({
    userId: z.string(),
    userName: z.string(),
    retries: z.number(),
  }),
}).createMachine({
  id: 'deepNested',
  context: ({ input }) => ({
    userId: input.user.id,
    userName: input.user.profile.name,
    retries: 0,
  }),
  initial: 'idle',
  states: {
    idle: { on: { FETCH: 'loading' } },
    loading: { on: { RESET: 'idle' } },
  },
});

/** 4) Discriminated Union input */
const unionInputMachine = typedSetup({
  events: { START: noPayload },
  input: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('guest'), sessionId: z.string() }),
    z.object({ mode: z.literal('user'), userId: z.string(), token: z.string() }),
    z.object({ mode: z.literal('admin'), userId: z.string(), adminLevel: z.number().int() }),
  ]),
  context: z.object({ mode: z.string(), identifier: z.string() }),
}).createMachine({
  id: 'unionInput',
  context: ({ input }) => ({
    mode: input.mode,
    identifier: input.mode === 'guest' ? input.sessionId : input.userId,
  }),
  initial: 'idle',
  states: { idle: { on: { START: 'running' } }, running: {} },
});

/** 5) typedSetup.input + send イベントの複合機械（最も複雑なケース） */
const fullMachine = typedSetup({
  events: {
    ADD_ITEM: z.object({ item: z.string(), qty: z.number().int().positive() }),
    REMOVE_ITEM: z.object({ item: z.string() }),
    CHECKOUT: noPayload,
    RESET: noPayload,
  },
  input: z.object({
    userId: z.string(),
    currency: z.enum(['JPY', 'USD', 'EUR']),
    taxRate: z.number().min(0).max(1),
  }),
  context: z.object({
    userId: z.string(),
    currency: z.string(),
    items: z.array(z.object({ name: z.string(), qty: z.number() })),
  }),
  strict: true,
}).createMachine({
  id: 'cart',
  context: ({ input }) => ({
    userId: input.userId,
    currency: input.currency,
    items: [],
  }),
  initial: 'browsing',
  states: {
    browsing: {
      on: {
        ADD_ITEM: {
          actions: assign({
            items: ({ context, event }) => [
              ...context.items,
              { name: event.item, qty: event.qty },
            ],
          }),
        },
        REMOVE_ITEM: {
          actions: assign({
            items: ({ context, event }) =>
              context.items.filter((i) => i.name !== event.item),
          }),
        },
        CHECKOUT: 'checkout',
      },
    },
    checkout: { on: { RESET: 'browsing' } },
  },
});

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function runInInjectionContext<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

// ─── テスト ───────────────────────────────────────────────────────────────────

describe('InputFrom<TLogic> type utility', () => {
  it('input なし machine → InputFrom は never', () => {
    type T = InputFrom<typeof noInputMachine>;
    expectTypeOf<T>().toBeNever();
  });

  it('number object input machine → InputFrom は { initialCount: number }', () => {
    type T = InputFrom<typeof numberInputMachine>;
    expectTypeOf<T>().toEqualTypeOf<{ initialCount: number }>();
  });

  it('deep nested input machine → InputFrom は深いネスト型', () => {
    type T = InputFrom<typeof deepNestedInputMachine>;
    type Expected = {
      user: {
        id: string;
        profile: {
          name: string;
          age: number;
          tags: string[];
        };
      };
      config: {
        maxRetries: number;
        timeout: number;
      };
    };
    expectTypeOf<T>().toEqualTypeOf<Expected>();
  });

  it('discriminated union input machine → InputFrom はユニオン型', () => {
    type T = InputFrom<typeof unionInputMachine>;
    type Expected =
      | { mode: 'guest'; sessionId: string }
      | { mode: 'user'; userId: string; token: string }
      | { mode: 'admin'; userId: string; adminLevel: number };
    expectTypeOf<T>().toEqualTypeOf<Expected>();
  });
});

describe('InjectActorOptions.input コンパイル時型安全', () => {
  it('input なし machine は InputFrom が never → factory 関数も () => never しか渡せない', () => {
    // InputFrom<noInputMachine> = never なので実質的に意味のある値を渡せない
    type InputType = InputFrom<typeof noInputMachine>;
    expectTypeOf<InputType>().toBeNever();
  });

  it('number input machine は { initialCount: number } のみ受け付ける（静的）', () => {
    type Opts = InjectActorOptions<typeof numberInputMachine>;
    type StaticInput = Exclude<NonNullable<Opts['input']>, () => unknown>;
    expectTypeOf<{ initialCount: number }>().toMatchTypeOf<StaticInput>();
  });

  it('number input machine は () => { initialCount: number } を受け付ける（動的）', () => {
    type Opts = InjectActorOptions<typeof numberInputMachine>;
    type DynamicInput = Extract<NonNullable<Opts['input']>, () => unknown>;
    expectTypeOf<() => { initialCount: number }>().toMatchTypeOf<DynamicInput>();
  });

  it('deep nested input machine は正確なネスト型を要求する', () => {
    type Opts = InjectActorOptions<typeof deepNestedInputMachine>;
    type StaticInput = Exclude<NonNullable<Opts['input']>, () => unknown>;

    // 正しい型は OK
    const valid: StaticInput = {
      user: {
        id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        profile: { name: 'Alice', age: 30, tags: ['admin'] },
      },
      config: { maxRetries: 3, timeout: 5000 },
    };
    expectTypeOf(valid).toMatchTypeOf<StaticInput>();
  });

  it('union input machine は全ユニオン分岐を受け付ける', () => {
    type Opts = InjectActorOptions<typeof unionInputMachine>;
    type StaticInput = Exclude<NonNullable<Opts['input']>, () => unknown>;

    const guest: StaticInput = { mode: 'guest', sessionId: 'sess-123' };
    const user: StaticInput = { mode: 'user', userId: 'u1', token: 'tok' };
    const admin: StaticInput = { mode: 'admin', userId: 'u2', adminLevel: 5 };

    expectTypeOf(guest).toMatchTypeOf<StaticInput>();
    expectTypeOf(user).toMatchTypeOf<StaticInput>();
    expectTypeOf(admin).toMatchTypeOf<StaticInput>();
  });

  it('wrong input type は InjectActorOptions への代入で型エラーを確認', () => {
    // 型エラーは変数への代入で検証（runtime 実行不要のため injection context 不要）
    // @ts-expect-error: string は number に割り当て不可
    const _a: InjectActorOptions<typeof numberInputMachine> = { input: { initialCount: 'bad' } };
    // @ts-expect-error: union の存在しない mode ('superadmin') はエラー
    const _b: InjectActorOptions<typeof unionInputMachine> = { input: { mode: 'superadmin', userId: 'x' } };
    // @ts-expect-error: input なし machine に対して { anything: 'here' } は never に非対応
    const _c: InjectActorOptions<typeof noInputMachine> = { input: { anything: 'here' } };

    void _a, _b, _c;
    expect(true).toBe(true);
  });
});

describe('injectActor runtime: 型正確な input で正しく動く', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('deep nested input が context に正しく反映される', () => {
    const { snapshot } = runInInjectionContext(() =>
      injectActor(deepNestedInputMachine, {
        input: {
          user: {
            id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            profile: { name: 'Bob', age: 25, tags: ['dev', 'oss'] },
          },
          config: { maxRetries: 5, timeout: 3000 },
        },
      }),
    );
    expect(snapshot().context.userId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(snapshot().context.userName).toBe('Bob');
  });

  it('discriminated union input: guest branch', () => {
    const { snapshot } = runInInjectionContext(() =>
      injectActor(unionInputMachine, {
        input: { mode: 'guest', sessionId: 'sess-xyz' },
      }),
    );
    expect(snapshot().context.mode).toBe('guest');
    expect(snapshot().context.identifier).toBe('sess-xyz');
  });

  it('discriminated union input: admin branch', () => {
    const { snapshot } = runInInjectionContext(() =>
      injectActor(unionInputMachine, {
        input: { mode: 'admin', userId: 'admin-007', adminLevel: 9 },
      }),
    );
    expect(snapshot().context.mode).toBe('admin');
    expect(snapshot().context.identifier).toBe('admin-007');
  });

  it('full machine: 複雑な input + send が両立する', () => {
    const { snapshot, send } = runInInjectionContext(() =>
      injectActor(fullMachine, {
        input: { userId: 'user-1', currency: 'JPY', taxRate: 0.1 },
      }),
    );
    expect(snapshot().context.userId).toBe('user-1');
    expect(snapshot().context.currency).toBe('JPY');

    send({ type: 'ADD_ITEM', item: 'coffee', qty: 2 });
    send({ type: 'ADD_ITEM', item: 'cake', qty: 1 });
    expect(snapshot().context.items).toHaveLength(2);
    expect(snapshot().context.items[0]).toEqual({ name: 'coffee', qty: 2 });

    send({ type: 'REMOVE_ITEM', item: 'coffee' });
    expect(snapshot().context.items).toHaveLength(1);
  });

  it('dynamic input (factory 関数) で Signal 変化を追跡する', () => {
    @Component({ template: '', standalone: true })
    class TestComponent {
      currency = signal<'JPY' | 'USD' | 'EUR'>('JPY');
      actor = injectActor(fullMachine, {
        // factory 関数: Signal の変化を追跡して actor を再作成
        input: () => ({
          userId: 'dynamic-user',
          currency: this.currency(),
          taxRate: 0.08,
        }),
      });
    }

    const fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.actor.snapshot().context.currency).toBe('JPY');

    fixture.componentInstance.currency.set('USD');
    TestBed.tick();

    expect(fixture.componentInstance.actor.snapshot().context.currency).toBe('USD');
  });

  it('union input を動的に切り替えると context が更新される', () => {
    @Component({ template: '', standalone: true })
    class TestComponent {
      mode = signal<'guest' | 'user'>('guest');
      actor = injectActor(unionInputMachine, {
        input: () =>
          this.mode() === 'guest'
            ? ({ mode: 'guest' as const, sessionId: 'sess-001' } as const)
            : ({ mode: 'user' as const, userId: 'user-999', token: 'tok-abc' } as const),
      });
    }

    const fixture = TestBed.createComponent(TestComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.actor.snapshot().context.mode).toBe('guest');
    expect(fixture.componentInstance.actor.snapshot().context.identifier).toBe('sess-001');

    fixture.componentInstance.mode.set('user');
    TestBed.tick();

    expect(fixture.componentInstance.actor.snapshot().context.mode).toBe('user');
    expect(fixture.componentInstance.actor.snapshot().context.identifier).toBe('user-999');
  });
});
