import type { Context, Env, Handler, Input, Next, TypedResponse } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

type NonVoidHandlerResponse<Body = unknown> =
  | Response
  | TypedResponse<Body>
  | Promise<Response | TypedResponse<Body>>;

export abstract class HttpError extends Error {
  abstract readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class BadRequestError extends HttpError {
  readonly status = 400;
}

export class UnauthorizedError extends HttpError {
  readonly status = 401;
}

export class ForbiddenError extends HttpError {
  readonly status = 403;
}

export class NotFoundError extends HttpError {
  readonly status = 404;
}

export class ConflictError extends HttpError {
  readonly status = 409;
}

export function createCodeMessageErrorSchema<TCode extends z.ZodType<string>>(codeSchema: TCode) {
  return z
    .object({
      code: codeSchema,
      message: z.string().min(1),
    })
    .strict();
}

export function handleHttpError(ctx: Context, error: unknown) {
  if (error instanceof HttpError) {
    return ctx.json(
      {
        code: error.code,
        message: error.message,
      },
      error.status,
    );
  }

  throw error;
}

export function withHttpErrorHandler<
  E extends Env,
  P extends string,
  I extends Input,
  R extends NonVoidHandlerResponse,
>(handler: Handler<E, P, I, R>): Handler<E, P, I, R>;

export function withHttpErrorHandler<
  E extends Env,
  P extends string,
  I extends Input,
  R extends NonVoidHandlerResponse,
>(handler: Handler<E, P, I, R>) {
  return async (ctx: Context<E, P, I>, next: Next) => {
    try {
      return await handler(ctx, next);
    } catch (error) {
      return handleHttpError(ctx, error);
    }
  };
}
