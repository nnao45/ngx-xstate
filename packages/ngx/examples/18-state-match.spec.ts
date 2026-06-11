/**
 * 18: 状態スコープ付き型安全イベント送信（case/when）
 *
 * actor.in('idle', idle => idle.send(...)) で、現在の状態にマッチしたときだけ
 * 実行し、その状態で有効なイベントだけを型安全に送れる。
 *
 * - .in(name, cb).in(name, cb) で case/when（同一階層・横）
 * - .within(name, cb) で複合状態の子へ潜る（cb を抜けるとトップに戻る）
 * - .otherwise() で default
 * - scope.send はその状態で無効なイベントをコンパイルエラーにする
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign } from 'xstate';
import { z } from 'zod';
import { injectActor, matchActor, noPayload, typedSetup } from '../src/public-api';

const trafficMachine = typedSetup({
  events: { GO: noPayload, CAUTION: noPayload, STOP: noPayload },
}).createMachine({
  id: 'traffic',
  initial: 'red',
  states: {
    red: { on: { GO: 'green' } },
    green: { on: { CAUTION: 'yellow' } },
    yellow: { on: { STOP: 'red' } },
  },
});

const sessionMachine = typedSetup({
  context: z.object({ user: z.string() }),
  events: {
    LOGIN: z.object({ user: z.string() }),
    LOGOUT: noPayload,
    IDLE: noPayload,
    WAKE: noPayload,
  },
}).createMachine({
  id: 'session',
  context: { user: '' },
  initial: 'anon',
  states: {
    anon: {
      on: { LOGIN: { target: 'auth', actions: assign({ user: ({ event }) => event.user }) } },
    },
    auth: {
      initial: 'active',
      states: {
        active: { on: { IDLE: 'idle' } },
        idle: { on: { WAKE: 'active' } },
      },
      on: { LOGOUT: 'anon' },
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

describe('18: State-scoped type-safe send (case/when)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('case/when chain dispatches only the active branch', () => {
    const { snapshot, in: $in } = run(() => injectActor(trafficMachine));

    // red の時だけ GO が走る
    $in('red', (red) => {
      red.send({ type: 'GO' });
    })
      .in('green', (green) => {
        green.send({ type: 'CAUTION' });
      })
      .otherwise(() => {
        throw new Error('unreachable');
      });

    expect(snapshot().value).toBe('green');
  });

  it('otherwise fires when no branch matches', () => {
    const { send, in: $in } = run(() => injectActor(trafficMachine));
    send({ type: 'GO' }); // green

    let fallback = false;
    $in('red', () => {
      throw new Error('unreachable');
    })
      .in('yellow', () => {
        throw new Error('unreachable');
      })
      .otherwise(() => {
        fallback = true;
      });

    expect(fallback).toBe(true);
  });

  it('descends into nested states with .within() and reads payload context', () => {
    const { snapshot, send, actorRef } = run(() => injectActor(sessionMachine));
    send({ type: 'LOGIN', user: 'alice' }); // auth.active

    matchActor(actorRef).within('auth', (s) =>
      s.in('active', (active) => {
        active.send({ type: 'IDLE' });
        expect(active.context.user).toBe('alice');
      }),
    );

    expect(snapshot().value).toEqual({ auth: 'idle' });
    expect(snapshot().context.user).toBe('alice');
  });

  it('re-ascends to a top-level branch after a within block', () => {
    const { snapshot, in: $in } = run(() => injectActor(sessionMachine)); // anon

    let anonRan = false;
    $in('anon', (anon) => {
      anon.send({ type: 'LOGIN', user: 'bob' });
    })
      .within('auth', (s) =>
        s.in('active', () => {
          throw new Error('unreachable — chain captured the anon snapshot');
        }),
      )
      .in('anon', () => {
        anonRan = true; // within を抜けてトップ階層へ戻れている
      });

    expect(anonRan).toBe(true);
    expect(snapshot().value).toEqual({ auth: 'active' });
  });
});

// ─── reportMachine: fold / map / tapAlways / foldMap / flatMap / attempt テスト用 ───

const reportMachine = typedSetup({
  context: z.object({
    count: z.number(),
    role: z.string(),
    rawJson: z.string(),
  }),
  events: {
    START: noPayload,
    FINISH: z.object({ rawJson: z.string() }),
    FAIL: noPayload,
    RESET: noPayload,
  },
}).createMachine({
  id: 'report',
  context: { count: 0, role: 'user', rawJson: '{}' },
  initial: 'idle',
  states: {
    idle: { on: { START: 'running' } },
    running: {
      on: {
        FINISH: { target: 'done', actions: assign({ rawJson: ({ event }) => event.rawJson }) },
        FAIL: { target: 'error', actions: assign({ count: ({ context }) => context.count + 1 }) },
      },
    },
    done: { on: { RESET: 'idle' } },
    error: { on: { RESET: 'idle' } },
  },
});

describe('fold — 状態から値を返す網羅的パターンマッチ', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('idle 状態で fold が "待機中" を返す', () => {
    const { actorRef } = run(() => injectActor(reportMachine));

    const result = matchActor(actorRef).fold({
      idle: () => '待機中',
      running: () => '実行中',
      done: () => '完了',
      error: () => 'エラー',
      _: () => '不明',
    });

    expect(result).toBe('待機中');
  });

  it('START 後 running 状態で fold が "実行中" を返す', () => {
    const { send, actorRef } = run(() => injectActor(reportMachine));
    send({ type: 'START' });

    const result = matchActor(actorRef).fold({
      idle: () => '待機中',
      running: () => '実行中',
      done: () => '完了',
      error: () => 'エラー',
      _: () => '不明',
    });

    expect(result).toBe('実行中');
  });
});

describe('map — Functor.map: context を view モデルに変換', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('map で変換した context が fold のスコープに渡る', () => {
    const { actorRef } = run(() => injectActor(reportMachine));

    const result = matchActor(actorRef)
      .map((ctx) => ({ label: `試行${ctx.count}回`, isAdmin: ctx.role === 'admin' }))
      .fold({ idle: (s) => s.context.label, _: () => '' });

    expect(result).toBe('試行0回');
  });

  it('map 後の context が変換済みの型になっている（isAdmin が boolean）', () => {
    const { actorRef } = run(() => injectActor(reportMachine));

    let seen: { label: string; isAdmin: boolean } | null = null;
    matchActor(actorRef)
      .map((ctx) => ({ label: `試行${ctx.count}回`, isAdmin: ctx.role === 'admin' }))
      .in('idle', (s) => {
        seen = s.context;
      });

    expect(seen).not.toBeNull();
    expect(seen!.isAdmin).toBe(false);
    expect(seen!.label).toBe('試行0回');
  });
});

describe('tapAlways — FlatMap.flatTap: matched を変えずにログを取る', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('tapAlways の cb は状態に関係なく常に実行される', () => {
    const { actorRef } = run(() => injectActor(reportMachine));

    const log: string[] = [];
    matchActor(actorRef).tapAlways((ctx) => {
      log.push(`count=${ctx.count}`);
    });

    expect(log).toEqual(['count=0']);
  });

  it('tapAlways は matched フラグを変えないので otherwise が抑制されない', () => {
    const { actorRef } = run(() => injectActor(reportMachine));

    let tapRan = false;
    let otherwiseRan = false;
    matchActor(actorRef)
      .tapAlways(() => {
        tapRan = true;
      })
      .in('running', () => {
        // idle なのでマッチしない
      })
      .otherwise(() => {
        otherwiseRan = true;
      });

    expect(tapRan).toBe(true);
    expect(otherwiseRan).toBe(true);
  });
});

describe('foldMap — Foldable.foldMap: モノイドで集約', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  const sumMonoid = { empty: 0, combine: (a: number, b: number) => a + b };

  it('idle 状態で foldMap が idle のハンドラ値 1 を返す', () => {
    const { actorRef } = run(() => injectActor(reportMachine));

    const result = matchActor(actorRef).foldMap(sumMonoid, {
      idle: () => 1,
      running: () => 10,
    });

    expect(result).toBe(1);
  });

  it('running 状態で foldMap が running のハンドラ値 10 を返す', () => {
    const { send, actorRef } = run(() => injectActor(reportMachine));
    send({ type: 'START' });

    const result = matchActor(actorRef).foldMap(sumMonoid, {
      idle: () => 1,
      running: () => 10,
    });

    expect(result).toBe(10);
  });
});

describe('flatMap — FlatMap.flatMap: context から Matcher を動的選択', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('role が "admin" のとき admin パスが実行される', () => {
    // role を 'admin' に書き換えた machine を作成して動作確認
    const adminReportMachine = typedSetup({
      context: z.object({
        count: z.number(),
        role: z.string(),
        rawJson: z.string(),
      }),
      events: {
        START: noPayload,
        FINISH: z.object({ rawJson: z.string() }),
        FAIL: noPayload,
        RESET: noPayload,
      },
    }).createMachine({
      id: 'report-admin',
      context: { count: 0, role: 'admin', rawJson: '{}' },
      initial: 'idle',
      states: {
        idle: { on: { START: 'running' } },
        running: {
          on: {
            FINISH: { target: 'done', actions: assign({ rawJson: ({ event }) => event.rawJson }) },
            FAIL: { target: 'error', actions: assign({ count: ({ context }) => context.count + 1 }) },
          },
        },
        done: { on: { RESET: 'idle' } },
        error: { on: { RESET: 'idle' } },
      },
    });

    const { actorRef } = run(() => injectActor(adminReportMachine));

    const paths: string[] = [];
    matchActor(actorRef).flatMap((ctx) => {
      if (ctx.role === 'admin') {
        return matchActor(actorRef).in('idle', () => paths.push('admin'));
      }
      return matchActor(actorRef).in('idle', () => paths.push('user'));
    });

    expect(paths).toEqual(['admin']);
  });

  it('role が "user" のとき user パスが実行される', () => {
    const { actorRef } = run(() => injectActor(reportMachine)); // role: 'user'

    const paths: string[] = [];
    matchActor(actorRef).flatMap((ctx) => {
      if (ctx.role === 'admin') {
        return matchActor(actorRef).in('idle', () => paths.push('admin'));
      }
      return matchActor(actorRef).in('idle', () => paths.push('user'));
    });

    expect(paths).toEqual(['user']);
  });
});

describe('attempt — IO.attempt: ハンドラの例外を捕捉', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('done 状態で rawJson が正しい JSON なら { ok: true, value: parsed } を返す', () => {
    const { send, actorRef } = run(() => injectActor(reportMachine));
    send({ type: 'START' });
    send({ type: 'FINISH', rawJson: '{"status":"ok"}' });

    const result = matchActor(actorRef).attempt({
      done: (s) => JSON.parse(s.context.rawJson) as unknown,
      _: () => null,
    });

    expect(result).toEqual({ ok: true, value: { status: 'ok' } });
  });

  it('done 状態で rawJson が壊れた JSON なら { ok: false, error } を返す', () => {
    const { send, actorRef } = run(() => injectActor(reportMachine));
    send({ type: 'START' });
    send({ type: 'FINISH', rawJson: 'NOT_VALID_JSON' });

    const result = matchActor(actorRef).attempt({
      done: (s) => JSON.parse(s.context.rawJson) as unknown,
      _: () => null,
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: unknown }).error).toBeInstanceOf(SyntaxError);
  });
});
