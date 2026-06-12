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
      expect(renderMermaid(authMachine)).toMatch(/^stateDiagram-v2/u);
    });

    it('renders initial transition and nested compound state with full-path IDs', () => {
      const diagram = renderMermaid(authMachine);
      expect(diagram).toBe(
        [
          'stateDiagram-v2',
          '    [*] --> loggedOut',
          '    loggedOut --> loggedIn : LOGIN',
          '    state loggedIn {',
          '        [*] --> loggedIn_active',
          '        state "active" as loggedIn_active',
          '        loggedIn_active --> loggedIn_idle : GO_IDLE',
          '        state "idle" as loggedIn_idle',
          '        loggedIn_idle --> loggedIn_active : WAKE_UP',
          '    }',
          '    loggedIn --> loggedOut : LOGOUT',
          '    closed --> [*]',
        ].join('\n'),
      );
    });

    it('renders parallel root with -- region separators and full-path IDs', () => {
      const diagram = renderMermaid(playerMachine);
      expect(diagram).toBe(
        [
          'stateDiagram-v2',
          '    state playback {',
          '        [*] --> playback_paused',
          '        state "paused" as playback_paused',
          '        state "playing" as playback_playing',
          '    }',
          '    --',
          '    state volume {',
          '        [*] --> volume_low',
          '        state "low" as volume_low',
          '        state "high" as volume_high',
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

    it('uses full-path mermaid IDs to avoid name collisions', () => {
      const collisionMachine = createMachine({
        initial: 'a',
        states: {
          a: {
            initial: 'idle',
            states: { idle: { on: { GO: 'done' } }, done: { type: 'final' } },
          },
          b: {
            initial: 'idle',
            states: { idle: { on: { GO: 'done' } }, done: { type: 'final' } },
          },
        },
      });
      const diagram = renderMermaid(collisionMachine);
      // Both nested states get globally-unique mermaid IDs
      expect(diagram).toContain('a_idle');
      expect(diagram).toContain('b_idle');
      // Transitions reference full-path IDs, not the bare key
      expect(diagram).toContain('a_idle --> a_done');
      expect(diagram).toContain('b_idle --> b_done');
      // No bare 'idle' appears as a mermaid node ID in transition arrows
      expect(diagram).not.toContain(' idle -->');
      expect(diagram).not.toContain('--> idle ');
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

    it('marks nested active states using full-path IDs after transition', () => {
      const actor = createActor(authMachine).start();
      actor.send({ type: 'LOGIN' }); // → loggedIn.active

      const diagram = renderMermaid(actor);
      expect(diagram).toContain('class loggedIn active');
      expect(diagram).toContain('class loggedIn_active active');
      expect(diagram).not.toContain('class loggedOut active');
      expect(diagram).not.toContain('class loggedIn_idle active');
    });

    it('marks both parallel regions and their active children with full-path IDs', () => {
      const actor = createActor(playerMachine).start();
      const diagram = renderMermaid(actor);

      expect(diagram).toContain('class playback active');
      expect(diagram).toContain('class volume active');
      expect(diagram).toContain('class playback_paused active');
      expect(diagram).toContain('class volume_low active');
      expect(diagram).not.toContain('class playback_playing active');
      expect(diagram).not.toContain('class volume_high active');
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
