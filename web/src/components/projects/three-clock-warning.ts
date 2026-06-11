/** `@react-three/fiber`'s render loop still constructs a `THREE.Clock`, which
 *  three r184 deprecated in favor of `THREE.Timer` — spamming one console warning
 *  per Canvas. Suppress just that one line (idempotent; safe to call from every
 *  Canvas host). */
export function silenceThreeClockWarning() {
  if (typeof window === 'undefined') {
    return;
  }
  const w = window as unknown as { __slClockWarnPatched?: boolean };
  if (w.__slClockWarnPatched) {
    return;
  }
  w.__slClockWarnPatched = true;
  /* eslint-disable no-console */
  const original = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('THREE.Clock')) {
      return;
    }
    original(...(args as []));
  };
  /* eslint-enable no-console */
}
