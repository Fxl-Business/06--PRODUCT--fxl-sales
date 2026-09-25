/**
 * The first row of a query result, failing the test loudly when there is none.
 *
 * The API test tree is type-checked under `noUncheckedIndexedAccess`, so
 * `rows[0]` and `const [row] = rows` are `T | undefined`. Reading a field off a
 * missing row would already fail the test with an anonymous TypeError; this
 * helper narrows the type and turns that failure into a message that names
 * which row the test expected.
 */
export function firstRow<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`expected a row for ${what}, but there was none`);
  }
  return row;
}
