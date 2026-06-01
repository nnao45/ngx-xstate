import { describe, expect, it } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { renderStateTree } from './render-state-tree';

// ─── テスト用 machine ───────────────────────────────────────────────────────

const authMachine = createMachine({
  id: 'auth',
  initial: 'loggedOut',
  states: {
    loggedOut: { on: { LOGIN: 'loggedIn' } },
    loggedIn: {
      initial: 'active',
      states: {
        active: { on: { GO_IDLE: 'idle' } },
        idle: { on: { WAKE_UP: 'active' } },
      },
      on: { LOGOUT: 'loggedOut' },
    },
    closed: { type: 'final' },
  },
});

const playerMachine = createMachine({
  id: 'player',
  type: 'parallel',
  states: {
    playback: {
      initial: 'paused',
      states: {
        paused: {},
        playing: {},
      },
    },
    volume: {
      initial: 'low',
      states: {
        low: {},
        high: {},
      },
    },
  },
});

const wizardMachine = createMachine({
  id: 'wizard',
  initial: 'step1',
  states: {
    step1: { on: { NEXT: 'step2' } },
    step2: {},
    hist: { type: 'history' },
  },
});

describe('renderStateTree', () => {
  describe('machine input (static structure, no markers)', () => {
    it('renders the hierarchy with tree connectors', () => {
      const tree = renderStateTree(authMachine);
      expect(tree).toBe(
        [
          'auth',
          '├─ loggedOut  (initial)',
          '├─ loggedIn',
          '│  ├─ active  (initial)',
          '│  └─ idle',
          '└─ closed  (final)',
        ].join('\n'),
      );
    });

    it('marks no current state for a machine', () => {
      expect(renderStateTree(authMachine)).not.toContain('●');
    });

    it('renders parallel root with badge and parallel regions', () => {
      const tree = renderStateTree(playerMachine);
      expect(tree).toBe(
        [
          'player  (parallel)',
          '├─ playback',
          '│  ├─ paused  (initial)',
          '│  └─ playing',
          '└─ volume',
          '   ├─ low  (initial)',
          '   └─ high',
        ].join('\n'),
      );
    });

    it('renders history state with badge', () => {
      const tree = renderStateTree(wizardMachine);
      expect(tree).toContain('└─ hist  (history)');
      expect(tree).toContain('├─ step1  (initial)');
    });
  });

  describe('actor input (current-state highlight)', () => {
    it('marks the active atomic state at the top level', () => {
      const actor = createActor(authMachine).start();
      const tree = renderStateTree(actor);

      expect(tree).toContain('auth ●');
      // loggedOut is the initial state of a running actor → active, marked
      const lines = tree.split('\n');
      expect(lines.find((l) => l.includes('loggedOut'))).toContain('●');
      expect(lines.find((l) => l.includes('closed'))).not.toContain('●');
    });

    it('marks nested active states after a transition', () => {
      const actor = createActor(authMachine).start();
      actor.send({ type: 'LOGIN' }); // → loggedIn.active

      const tree = renderStateTree(actor);
      const lines = tree.split('\n');

      expect(lines.find((l) => l.includes('loggedIn'))).toContain('●');
      expect(lines.find((l) => l.includes('active'))).toContain('●');
      expect(lines.find((l) => l.includes('idle'))).not.toContain('●');
      expect(lines.find((l) => l.includes('loggedOut'))).not.toContain('●');
    });

    it('marks every active region of a parallel machine', () => {
      const actor = createActor(playerMachine).start();
      const tree = renderStateTree(actor);
      const lines = tree.split('\n');

      // 両領域の初期状態がアクティブ
      expect(lines.find((l) => l.includes('paused'))).toContain('●');
      expect(lines.find((l) => l.includes('low'))).toContain('●');
      expect(lines.find((l) => l.includes('playing'))).not.toContain('●');
      expect(lines.find((l) => l.includes('high'))).not.toContain('●');
      // 領域ノード自体もアクティブ
      expect(lines.find((l) => l.startsWith('├─ playback'))).toContain('●');
      expect(lines.find((l) => l.startsWith('└─ volume'))).toContain('●');
    });

    it('renders a flat (no nested states) machine', () => {
      const flat = createMachine({
        id: 'flat',
        initial: 'a',
        states: { a: {}, b: {} },
      });
      const actor = createActor(flat).start();
      const tree = renderStateTree(actor);

      expect(tree).toBe(['flat ●', '├─ a ●  (initial)', '└─ b'].join('\n'));
    });
  });
});
