export function unwrapOpenApiFetchResponse<T>(input: { data?: T; error?: unknown }): T | undefined {
  if (input.error !== undefined) {
    throw input.error;
  }

  return input.data;
}
