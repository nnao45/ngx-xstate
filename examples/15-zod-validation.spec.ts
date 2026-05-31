/**
 * 15: Zod ランタイムバリデーション活用
 *
 * createTypedMachine の events に複雑な Zod スキーマを与え、send() 時に
 * ペイロードがランタイム検証されることを多角的に確認する。
 *
 * - 形式 (email) / 範囲 (min/max/int) / enum / 配列 / ネストオブジェクト
 * - z.refine によるクロスフィールド検証
 * - strict: false → warn + no-op / strict: true → ZodError throw
 * - ZodError の中身（issues）を検証
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assign } from 'xstate';
import { z, ZodError } from 'zod';
import { createTypedMachine, injectActor, noPayload } from '../src/public-api';

function run<T>(fn: () => T): T {
  let result!: T;
  TestBed.runInInjectionContext(() => {
    result = fn();
  });
  return result;
}

// ユーザー登録 machine — リッチな payload スキーマ
const registrationContext = z.object({
  email: z.string(),
  age: z.number(),
  role: z.enum(['admin', 'user', 'guest']),
  tags: z.array(z.string()),
  address: z.object({ city: z.string(), zip: z.string() }).nullable(),
  submitted: z.boolean(),
});

const makeRegistration = (strict: boolean) =>
  createTypedMachine({
    context: registrationContext,
    events: {
      SET_EMAIL: z.object({ value: z.string().email() }),
      SET_AGE: z.object({ value: z.number().int().min(0).max(150) }),
      SET_ROLE: z.object({ value: z.enum(['admin', 'user', 'guest']) }),
      ADD_TAG: z.object({ tag: z.string().min(1).max(20) }),
      SET_ADDRESS: z.object({
        address: z.object({ city: z.string().min(1), zip: z.string().regex(/^\d{3}-\d{4}$/u) }),
      }),
      // フィールドレベル refine: パスワード強度（ZodObject を保つため refine は中のフィールドに）
      SUBMIT: z.object({
        password: z
          .string()
          .min(8)
          .refine((s) => /[A-Z]/u.test(s) && /\d/u.test(s), {
            message: 'password must contain an uppercase letter and a digit',
          }),
      }),
      RESET: noPayload,
    },
    strict,
  }).create({
    id: 'registration',
    context: {
      email: '',
      age: 0,
      role: 'guest',
      tags: [],
      address: null,
      submitted: false,
    },
    on: {
      SET_EMAIL: { actions: assign({ email: ({ event }) => event.value }) },
      SET_AGE: { actions: assign({ age: ({ event }) => event.value }) },
      SET_ROLE: { actions: assign({ role: ({ event }) => event.value }) },
      ADD_TAG: { actions: assign({ tags: ({ context, event }) => [...context.tags, event.tag] }) },
      SET_ADDRESS: { actions: assign({ address: ({ event }) => event.address }) },
      SUBMIT: { actions: assign({ submitted: true }) },
      RESET: { actions: assign({ submitted: false, tags: [] }) },
    },
  });

describe('15: Zod runtime validation', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('strict: false → warn + no-op', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('accepts a valid email', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(false)));
      send({ type: 'SET_EMAIL', value: 'alice@example.com' });
      expect(snapshot().context.email).toBe('alice@example.com');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('rejects an invalid email (no-op + warn)', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(false)));
      send({ type: 'SET_EMAIL', value: 'not-an-email' } as never);
      expect(snapshot().context.email).toBe('');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('enforces integer + range on age', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(false)));

      send({ type: 'SET_AGE', value: 30 });
      expect(snapshot().context.age).toBe(30);

      send({ type: 'SET_AGE', value: 200 } as never); // > max
      send({ type: 'SET_AGE', value: 3.5 } as never); // not int
      send({ type: 'SET_AGE', value: -1 } as never); // < min
      expect(snapshot().context.age).toBe(30); // どれも弾かれ変化なし
    });

    it('enforces enum on role', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(false)));

      send({ type: 'SET_ROLE', value: 'admin' });
      expect(snapshot().context.role).toBe('admin');

      send({ type: 'SET_ROLE', value: 'superuser' } as never); // enum外
      expect(snapshot().context.role).toBe('admin');
    });

    it('enforces string length on tags', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(false)));

      send({ type: 'ADD_TAG', tag: 'angular' });
      send({ type: 'ADD_TAG', tag: '' } as never); // min(1) 違反
      send({ type: 'ADD_TAG', tag: 'x'.repeat(21) } as never); // max(20) 違反

      expect(snapshot().context.tags).toEqual(['angular']);
    });

    it('validates nested object + regex on address', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(false)));

      send({ type: 'SET_ADDRESS', address: { city: 'Tokyo', zip: '100-0001' } });
      expect(snapshot().context.address).toEqual({ city: 'Tokyo', zip: '100-0001' });

      send({ type: 'SET_ADDRESS', address: { city: 'Osaka', zip: 'BADZIP' } } as never); // regex違反
      send({ type: 'SET_ADDRESS', address: { city: '', zip: '100-0001' } } as never); // city空
      expect(snapshot().context.address).toEqual({ city: 'Tokyo', zip: '100-0001' });
    });

    it('field-level refine: SUBMIT requires a strong password', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(false)));

      send({ type: 'SUBMIT', password: 'Ab1' } as never); // min(8) 違反
      expect(snapshot().context.submitted).toBe(false);

      send({ type: 'SUBMIT', password: 'alllowercase' } as never); // refine違反(大文字/数字なし)
      expect(snapshot().context.submitted).toBe(false);

      send({ type: 'SUBMIT', password: 'StrongPass1' }); // OK
      expect(snapshot().context.submitted).toBe(true);
    });
  });

  describe('strict: true → throws ZodError', () => {
    it('throws on invalid email and the error carries Zod issues', () => {
      const { send } = run(() => injectActor(makeRegistration(true)));

      let caught: unknown;
      try {
        send({ type: 'SET_EMAIL', value: 'nope' } as never);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ZodError);
      expect((caught as ZodError).issues.length).toBeGreaterThan(0);
    });

    it('throws on refine failure with the custom message', () => {
      const { send } = run(() => injectActor(makeRegistration(true)));

      let caught: unknown;
      try {
        // min(8) は満たすが大文字/数字なし → refine 違反
        send({ type: 'SUBMIT', password: 'alllowercase' } as never);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ZodError);
      expect((caught as ZodError).issues[0]?.message).toBe(
        'password must contain an uppercase letter and a digit',
      );
    });

    it('throws on unknown event type', () => {
      const { send } = run(() => injectActor(makeRegistration(true)));
      expect(() => {
        send({ type: 'NUKE' } as never);
      }).toThrow(ZodError);
    });

    it('allows fully valid sequence without throwing', () => {
      const { snapshot, send } = run(() => injectActor(makeRegistration(true)));

      expect(() => {
        send({ type: 'SET_EMAIL', value: 'bob@example.com' });
        send({ type: 'SET_AGE', value: 42 });
        send({ type: 'SET_ROLE', value: 'user' });
        send({ type: 'ADD_TAG', tag: 'verified' });
        send({ type: 'SET_ADDRESS', address: { city: 'Kyoto', zip: '600-8001' } });
        send({ type: 'SUBMIT', password: 'SuperSecret1' });
      }).not.toThrow();

      expect(snapshot().context).toMatchObject({
        email: 'bob@example.com',
        age: 42,
        role: 'user',
        tags: ['verified'],
        address: { city: 'Kyoto', zip: '600-8001' },
        submitted: true,
      });
    });
  });
});
