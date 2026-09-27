/**
 * Helpers the browser components use to talk to our API.
 *
 * The important part is that neither of these ever throws. A route that fails
 * in an unexpected way returns an HTML error page, not JSON — calling
 * `res.json()` on that raises a SyntaxError, and if that happens in the middle
 * of a submit handler the rest of the handler never runs, leaving a button
 * stuck on "Sending…" with no explanation.
 */

/** Parse a JSON response body. Returns `{}` if the body is missing or not JSON. */
export async function readBody<T>(res: Response): Promise<Partial<T> & { error?: string }> {
  try {
    return (await res.json()) as Partial<T> & { error?: string };
  } catch {
    return {};
  }
}

/** A message to show the user for a failed response. */
export async function errorFrom(res: Response): Promise<string> {
  const body = await readBody<{ error?: string }>(res);
  return body.error ?? `Something went wrong (${res.status}). Please try again.`;
}
