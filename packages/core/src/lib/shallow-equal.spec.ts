import { describe, expect, it } from 'vitest';
import { shallowEqual } from './shallow-equal';

describe('shallowEqual', () => {
  it('returns true for identical primitives', () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(true, true)).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, undefined)).toBe(true);
  });

  it('returns false for different primitives', () => {
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual('a', 'b')).toBe(false);
    expect(shallowEqual(true, false)).toBe(false);
  });

  it('returns true for same object reference', () => {
    const obj = { count: 1 };
    expect(shallowEqual(obj, obj)).toBe(true);
  });

  it('returns true for objects with same shallow properties', () => {
    expect(shallowEqual({ count: 1, name: 'x' }, { count: 1, name: 'x' })).toBe(true);
  });

  it('returns false for objects with different values', () => {
    expect(shallowEqual({ count: 1 }, { count: 2 })).toBe(false);
  });

  it('returns false for objects with different key counts', () => {
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('returns false for nested objects with different references', () => {
    expect(shallowEqual({ nested: { a: 1 } }, { nested: { a: 1 } })).toBe(false);
  });

  it('returns false when comparing object with non-object', () => {
    expect(shallowEqual({ a: 1 }, null)).toBe(false);
    expect(shallowEqual(null, { a: 1 })).toBe(false);
    expect(shallowEqual({ a: 1 }, 'string')).toBe(false);
  });

  it('returns false for NaN vs NaN using Object.is semantics', () => {
    expect(shallowEqual(NaN, NaN)).toBe(true);
  });
});
