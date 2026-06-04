export type IntegrationMiddlewareNext = () => Promise<void>;

export type IntegrationMiddleware<TContext> = (
  context: TContext,
  next: IntegrationMiddlewareNext,
) => void | Promise<void>;

export function composeIntegrationMiddleware<TContext>(
  middleware: readonly IntegrationMiddleware<TContext>[],
): IntegrationMiddleware<TContext> {
  return async function runComposedIntegrationMiddleware(context, next) {
    let dispatchedIndex = -1;

    function createNext(index: number): IntegrationMiddlewareNext {
      return function runNext() {
        const nextIndex = index + 1;
        if (nextIndex <= dispatchedIndex) {
          throw new Error("Integration middleware next() called multiple times.");
        }

        return dispatch(nextIndex);
      };
    }

    async function dispatch(index: number): Promise<void> {
      if (index <= dispatchedIndex) {
        throw new Error("Integration middleware next() called multiple times.");
      }

      dispatchedIndex = index;
      const currentMiddleware = middleware[index];
      if (currentMiddleware === undefined) {
        await next();
        return;
      }

      await currentMiddleware(context, createNext(index));
    }

    await dispatch(0);
  };
}
