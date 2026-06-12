import { GUARD_LABEL_KEY } from './compat/xstate-v5';

/**
 * Wraps a guard predicate with a human-readable label that surfaces in
 * TransitionInfo.guardLabel and inspect().explainBlocked().
 *
 * @example
 * setup({
 *   guards: {
 *     cartNotEmpty: explainGuard('cartNotEmpty', 'cart must not be empty',
 *       ({ context }) => context.cart.length > 0),
 *   },
 * })
 */
export function explainGuard<TArgs>(
  name: string,
  label: string,
  predicate: (args: TArgs) => boolean,
): (args: TArgs) => boolean {
  const fn = (args: TArgs): boolean => predicate(args);
  // Arrow function .name is non-writable; defineProperty works because it's configurable.
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  (fn as unknown as Record<string, unknown>)[GUARD_LABEL_KEY] = label;
  return fn;
}
