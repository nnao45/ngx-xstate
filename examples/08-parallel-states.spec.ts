/**
 * 08: Parallel States — 並列状態領域
 *
 * type: 'parallel' で複数の状態領域が同時に動く。
 * statecharts.dev の「並列状態」概念に直接対応。
 *
 * createTypedMachine: PLAY / PAUSE / MUTE / UNMUTE / ENTER_FULLSCREEN / EXIT_FULLSCREEN
 * を on キーから全領域横断で自動推論。
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTypedMachine, injectActor } from '../src/public-api';

const mediaPlayerMachine = createTypedMachine({
  id: 'mediaPlayer',
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
    fullscreen: {
      initial: 'windowed',
      states: {
        windowed: { on: { ENTER_FULLSCREEN: 'fullscreen' } },
        fullscreen: { on: { EXIT_FULLSCREEN: 'windowed' } },
      },
    },
  },
});

describe('08: Parallel States — Media player', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('starts with all regions in initial state', () => {
    const { snapshot } = TestBed.runInInjectionContext(() => injectActor(mediaPlayerMachine));

    expect(snapshot().value).toEqual({
      playback: 'paused',
      volume: 'unmuted',
      fullscreen: 'windowed',
    });
  });

  it('transitions only the playback region on PLAY', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(mediaPlayerMachine));

    send({ type: 'PLAY' });

    // PLAY は playback 領域だけ変化させる — 他は独立して変わらない
    expect(snapshot().value).toEqual({
      playback: 'playing',
      volume: 'unmuted',
      fullscreen: 'windowed',
    });
  });

  it('each region is fully independent', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(mediaPlayerMachine));

    send({ type: 'PLAY' });
    send({ type: 'MUTE' });
    send({ type: 'ENTER_FULLSCREEN' });

    expect(snapshot().value).toEqual({
      playback: 'playing',
      volume: 'muted',
      fullscreen: 'fullscreen',
    });
  });

  it('can query individual region with matches()', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(mediaPlayerMachine));

    send({ type: 'PLAY' });
    send({ type: 'MUTE' });

    expect(snapshot().matches({ playback: 'playing' })).toBe(true);
    expect(snapshot().matches({ volume: 'muted' })).toBe(true);
    expect(snapshot().matches({ fullscreen: 'windowed' })).toBe(true);
  });

  it('pausing does not affect volume or fullscreen', () => {
    const { snapshot, send } = TestBed.runInInjectionContext(() => injectActor(mediaPlayerMachine));

    send({ type: 'PLAY' });
    send({ type: 'MUTE' });
    send({ type: 'PAUSE' });

    expect(snapshot().value).toEqual({
      playback: 'paused',
      volume: 'muted',
      fullscreen: 'windowed',
    });
  });
});
