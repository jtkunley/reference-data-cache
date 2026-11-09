/** Calls `fn`, turning a synchronous throw into a rejected promise. */
export function attempt<T>(fn: () => PromiseLike<T> | T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}
