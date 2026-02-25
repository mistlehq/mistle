import type { MiddlewareHandler } from "hono";

import { z } from "zod";

import type { AppContextBindings, AppSession } from "../types.js";

const AuthErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  ACTIVE_ORGANIZATION_REQUIRED: "ACTIVE_ORGANIZATION_REQUIRED",
} as const;

const SessionShapeSchema = z.looseObject({
  user: z.looseObject({
    id: z.string().min(1),
  }),
  session: z.looseObject({
    id: z.string().min(1),
    userId: z.string().min(1),
    activeOrganizationId: z.string().min(1).nullable().optional(),
  }),
});

type ParseSessionResult =
  | {
      kind: "unauthorized";
    }
  | {
      kind: "forbidden";
    }
  | {
      kind: "ok";
      session: AppSession;
    };

function parseSession(value: unknown): ParseSessionResult {
  const parsedSession = SessionShapeSchema.safeParse(value);
  if (!parsedSession.success) {
    return { kind: "unauthorized" };
  }

  const { user, session } = parsedSession.data;
  const activeOrganizationId = session.activeOrganizationId;
  if (activeOrganizationId === undefined) {
    return { kind: "forbidden" };
  }
  if (activeOrganizationId === null) {
    return { kind: "forbidden" };
  }

  return {
    kind: "ok",
    session: {
      user: {
        id: user.id,
      },
      session: {
        id: session.id,
        userId: session.userId,
        activeOrganizationId,
      },
    },
  };
}

export function createRequireAuthSessionMiddleware(): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const session = await ctx.get("services").auth.api.getSession({
      headers: ctx.req.raw.headers,
    });
    const parsedSession = parseSession(session);

    if (parsedSession.kind === "unauthorized") {
      return ctx.json(
        {
          code: AuthErrorCodes.UNAUTHORIZED,
          message: "Unauthorized API request.",
        },
        401,
      );
    }

    if (parsedSession.kind === "forbidden") {
      return ctx.json(
        {
          code: AuthErrorCodes.ACTIVE_ORGANIZATION_REQUIRED,
          message: "Active organization is required for this request.",
        },
        403,
      );
    }

    ctx.set("session", parsedSession.session);
    await next();
  };
}
