/**
 * 溜めていた例外を1つにまとめる\
 * 1件ならそのまま、複数なら AggregateError にまとめる
 */
export function toError(
  errors: readonly unknown[],
  message = 'Multiple errors were thrown while handling events',
): unknown {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
}

/**
 * 溜めていた例外を投げる
 */
export function throwErrors(errors: readonly unknown[]): void {
  if (errors.length > 0) {
    throw toError(errors);
  }
}
