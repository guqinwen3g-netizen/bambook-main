export async function withRequestDeadline<T>(controller: AbortController, timeout: number, message: string, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { signal } = controller;
  signal.throwIfAborted();
  const timer = window.setTimeout(() => controller.abort(new Error(message)), timeout);
  let onAbort: () => void = () => {};
  // Release the request slot even if the request or response processing does not settle after abort.
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([request(signal), interrupted]);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
