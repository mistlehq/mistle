export type RespondToServerRequest = (
  requestId: string | number,
  result: unknown,
) => Promise<void> | void;

export function submitServerRequestResponse(input: {
  onRespondToServerRequest: RespondToServerRequest;
  requestId: string | number;
  response: unknown;
}): void {
  void Promise.resolve(input.onRespondToServerRequest(input.requestId, input.response)).catch(
    () => {
      return;
    },
  );
}
