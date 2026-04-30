export class ScheduleDispatchPermanentError extends Error {
  readonly failureCode: string;

  constructor(input: { failureCode: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.failureCode = input.failureCode;
  }
}
