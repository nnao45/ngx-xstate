import { describe, expect, it } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { renderMermaid } from './render-mermaid';

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

describe('renderMermaid', () => {
  describe('machine input (static structure)', () => {
    it('outputs stateDiagram-v2 header', () => {
      expect(renderMermaid(authMachine)).toMatch(/^stateDiagram-v2/);
    });

    it('renders initial transition and nested compound state', () => {
      const diagram = renderMermaid(authMachine);
      expect(diagram).toBe(
        [
          'stateDiagram-v2',
          '    [*] --> loggedOut',
          '    loggedOut --> loggedIn : LOGIN',
          '    state loggedIn {',
          '        [*] --> active',
          '        active --> idle : GO_IDLE',
          '        idle --> active : WAKE_UP',
          '    }',
          '    loggedIn --> loggedOut : LOGOUT',
          '    closed --> [*]',
        ].join('\n'),
      );
    });

    it('renders parallel root with -- region separators', () => {
      const diagram = renderMermaid(playerMachine);
      expect(diagram).toBe(
        [
          'stateDiagram-v2',
          '    state playback {',
          '        [*] --> paused',
          '    }',
          '    --',
          '    state volume {',
          '        [*] --> low',
          '    }',
        ].join('\n'),
      );
    });

    it('renders history state with <<history>> annotation', () => {
      const diagram = renderMermaid(wizardMachine);
      expect(diagram).toContain('state hist <<history>>');
    });

    it('does not include classDef or class annotations for machine input', () => {
      const diagram = renderMermaid(authMachine);
      expect(diagram).not.toContain('classDef');
      expect(diagram).not.toContain('class ');
    });
  });

  describe('actor input (active state highlight)', () => {
    it('includes classDef active when actor is running', () => {
      const actor = createActor(authMachine).start();
      const diagram = renderMermaid(actor);
      expect(diagram).toContain('classDef active font-weight:bold,stroke-width:2px');
    });

    it('marks the initial active state', () => {
      const actor = createActor(authMachine).start();
      const diagram = renderMermaid(actor);
      expect(diagram).toContain('class loggedOut active');
      expect(diagram).not.toContain('class loggedIn active');
    });

    it('marks nested active states after transition', () => {
      const actor = createActor(authMachine).start();
      actor.send({ type: 'LOGIN' }); // → loggedIn.active

      const diagram = renderMermaid(actor);
      expect(diagram).toContain('class loggedIn active');
      expect(diagram).toContain('class active active');
      expect(diagram).not.toContain('class loggedOut active');
      expect(diagram).not.toContain('class idle active');
    });

    it('marks both parallel regions and their active children', () => {
      const actor = createActor(playerMachine).start();
      const diagram = renderMermaid(actor);

      expect(diagram).toContain('class playback active');
      expect(diagram).toContain('class volume active');
      expect(diagram).toContain('class paused active');
      expect(diagram).toContain('class low active');
      expect(diagram).not.toContain('class playing active');
      expect(diagram).not.toContain('class high active');
    });

    it('renders a flat machine with active marker', () => {
      const flat = createMachine({
        id: 'flat',
        initial: 'a',
        states: { a: {}, b: {} },
      });
      const actor = createActor(flat).start();
      const diagram = renderMermaid(actor);

      expect(diagram).toContain('[*] --> a');
      expect(diagram).toContain('class a active');
      expect(diagram).not.toContain('class b active');
    });
  });
});
