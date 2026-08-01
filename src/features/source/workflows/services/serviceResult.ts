/**
 * The workflow services report failures as a returned `{ error }` rather than a
 * rejection, which is easy to ignore by accident. Callers that mutate local
 * state on the assumption a write landed should funnel through `unwrap` so a
 * failure becomes a throw their surrounding try/catch can see.
 */
export interface ServiceResult<T> {
  data: T | null
  error: Error | null
}

export async function unwrap<T>(operation: Promise<ServiceResult<T>>): Promise<T | null> {
  const { data, error } = await operation
  if (error) throw error
  return data
}

/** Same as `unwrap`, but also rejects when the service returned no row. */
export async function unwrapRequired<T>(
  operation: Promise<ServiceResult<T>>,
  what: string,
): Promise<T> {
  const data = await unwrap(operation)
  if (!data) throw new Error(`${what} returned no data`)
  return data
}
