import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { assign, createMachine } from 'xstate';
import { createActorContext } from './create-actor-context';

const counterMachine = createMachine({
  id: 'counter',
  initial: 'active',
  context: { count: 0 },
  states: {
    active: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
      },
    },
  },
});

const CounterContext = createActorContext(counterMachine);

describe('createActorContext', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('returns provideActor, injectActorRef, and injectSelector', () => {
    expect(typeof CounterContext.provideActor).toBe('function');
    expect(typeof CounterContext.injectActorRef).toBe('function');
    expect(typeof CounterContext.injectSelector).toBe('function');
  });

  it('injectActorRef resolves actor when provideActor is used', () => {
    @Component({
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class ParentComponent {
      actor = CounterContext.injectActorRef();
    }

    const fixture = TestBed.createComponent(ParentComponent);
    expect(fixture.componentInstance.actor).toBeDefined();
    expect(fixture.componentInstance.actor.getSnapshot().context.count).toBe(0);
  });

  it('injectSelector returns a Signal derived from actor state', () => {
    @Component({
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

  it('two separate provideActor() calls create independent actor instances', () => {
    @Component({
      selector: 'test-component-a',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class ComponentA {
      actor = CounterContext.injectActorRef();
    }

    @Component({
      selector: 'test-component-b',
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class ComponentB {
      actor = CounterContext.injectActorRef();
    }

    const fixtureA = TestBed.createComponent(ComponentA);
    const fixtureB = TestBed.createComponent(ComponentB);

    fixtureA.componentInstance.actor.send({ type: 'INCREMENT' });
    fixtureA.componentInstance.actor.send({ type: 'INCREMENT' });

    expect(fixtureA.componentInstance.actor.getSnapshot().context.count).toBe(2);
    expect(fixtureB.componentInstance.actor.getSnapshot().context.count).toBe(0);
  });

  it('throws when injectActorRef is called without provideActor', () => {
    expect(() => {
      TestBed.runInInjectionContext(() => CounterContext.injectActorRef());
    }).toThrow('[@zstate/ngx]');
  });

  it('actors stop when component is destroyed', () => {
    @Component({
      template: '',
      standalone: true,
      providers: [CounterContext.provideActor()],
    })
    class TestComponent {
      actor = CounterContext.injectActorRef();
    }

    const fixture = TestBed.createComponent(TestComponent);
    const actor = fixture.componentInstance.actor;
    expect(actor.getSnapshot().status).toBe('active');
    fixture.destroy();
    expect(actor.getSnapshot().status).toBe('stopped');
  });
});
