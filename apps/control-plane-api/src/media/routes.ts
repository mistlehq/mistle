import { OpenAPIHono } from "@hono/zod-openapi";
import { ControlPlaneDbSchema } from "@mistle/db/control-plane";
import { OpenApiValidationHook } from "@mistle/http/errors.js";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { typeid } from "typeid-js";
import { z } from "zod";

import { parseOrganizationRole } from "../auth/services/organization-policy.js";
import type { AppContext, AppContextBindings } from "../types.js";
import { MEDIA_ROUTE_BASE_PATH } from "./constants.js";

const AvatarContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const MaxAvatarFileSizeBytes = 5 * 1024 * 1024;
const MinAvatarDimension = 128;
const UploadSessionTtlMs = 15 * 60 * 1000;
const SignedReadTtlMs = 5 * 60 * 1000;

const CreateUploadSessionBodySchema = z
  .object({
    subject: z
      .object({
        kind: z.enum(["user", "organization"]),
        id: z.string().min(1),
      })
      .strict(),
    contentType: z.string().min(1),
    fileSize: z.number().int().min(1).max(MaxAvatarFileSizeBytes),
    fileName: z.string().min(1),
  })
  .strict();

const FinalizeUploadBodySchema = z
  .object({
    uploadSessionId: z.string().min(1),
  })
  .strict();

type AuthenticatedUserSession = {
  userId: string;
};

export function createMediaRoutes(): {
  basePath: typeof MEDIA_ROUTE_BASE_PATH;
  routes: OpenAPIHono<AppContextBindings>;
} {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.post("/avatar-upload-sessions", async (ctx) => {
    const session = await requireAuthenticatedUserSession(ctx);
    if (session === null) {
      return ctx.json({ code: "UNAUTHORIZED", message: "Unauthorized API request." }, 401);
    }
    const body = CreateUploadSessionBodySchema.parse(await ctx.req.json());
    const db = ctx.get("db");
    const mediaService = ctx.get("mediaService");

    if (!AvatarContentTypes.has(body.contentType)) {
      return ctx.json({ code: "BAD_REQUEST", message: "Unsupported avatar content type." }, 400);
    }

    if (body.subject.kind === "user" && body.subject.id !== session.userId) {
      return ctx.json({ code: "FORBIDDEN", message: "Forbidden API request." }, 403);
    }

    if (body.subject.kind === "organization") {
      const canManage = await canManageOrganization({
        db,
        actorUserId: session.userId,
        organizationId: body.subject.id,
      });
      if (!canManage) {
        return ctx.json({ code: "FORBIDDEN", message: "Forbidden API request." }, 403);
      }
    }

    const uploadSessionId = typeid("aus").toString();
    const expiresAt = new Date(Date.now() + UploadSessionTtlMs);
    const temporaryObjectKey = mediaService.buildTempObjectKey({
      subject:
        body.subject.kind === "user"
          ? {
              kind: "user",
              userId: body.subject.id,
            }
          : {
              kind: "organization",
              organizationId: body.subject.id,
            },
      uploadSessionId,
      filename: body.fileName,
    });

    await db.insert(ControlPlaneDbSchema.avatarUploadSessions).values({
      id: uploadSessionId,
      actorUserId: session.userId,
      subjectKind: body.subject.kind,
      subjectId: body.subject.id,
      temporaryObjectKey,
      sourceContentType: body.contentType,
      sourceFileSize: body.fileSize,
      expiresAt,
    });

    const upload = await mediaService.createDirectUpload({
      objectKey: temporaryObjectKey,
      contentType: body.contentType,
      expiresAt,
    });

    return ctx.json(
      {
        upload,
        uploadSessionId,
        expiresAt: expiresAt.toISOString(),
      },
      200,
    );
  });

  routes.post("/avatar-upload-sessions/finalize", async (ctx) => {
    const session = await requireAuthenticatedUserSession(ctx);
    if (session === null) {
      return ctx.json({ code: "UNAUTHORIZED", message: "Unauthorized API request." }, 401);
    }
    const body = FinalizeUploadBodySchema.parse(await ctx.req.json());
    const db = ctx.get("db");
    const mediaService = ctx.get("mediaService");

    const uploadSession = await db.query.avatarUploadSessions.findFirst({
      where: (table, { eq }) => eq(table.id, body.uploadSessionId),
    });
    if (uploadSession === undefined) {
      return ctx.json({ code: "NOT_FOUND", message: "Upload session was not found." }, 404);
    }

    if (uploadSession.actorUserId !== session.userId) {
      return ctx.json({ code: "FORBIDDEN", message: "Forbidden API request." }, 403);
    }

    if (uploadSession.finalizedAt !== null) {
      return ctx.json({ code: "CONFLICT", message: "Upload session is already finalized." }, 409);
    }

    if (uploadSession.expiresAt.getTime() <= Date.now()) {
      return ctx.json({ code: "BAD_REQUEST", message: "Upload session has expired." }, 400);
    }

    const subject =
      uploadSession.subjectKind === "user"
        ? { kind: "user" as const, userId: uploadSession.subjectId }
        : { kind: "organization" as const, organizationId: uploadSession.subjectId };

    if (subject.kind === "organization") {
      const canManage = await canManageOrganization({
        db,
        actorUserId: session.userId,
        organizationId: subject.organizationId,
      });
      if (!canManage) {
        return ctx.json({ code: "FORBIDDEN", message: "Forbidden API request." }, 403);
      }
    }

    let uploadedObject;
    try {
      uploadedObject = await mediaService.readObject({
        objectKey: uploadSession.temporaryObjectKey,
      });
    } catch {
      return ctx.json(
        { code: "NOT_FOUND", message: "Uploaded temporary object was not found." },
        404,
      );
    }

    if (
      uploadedObject.bytes.length > MaxAvatarFileSizeBytes ||
      uploadedObject.bytes.length > Number(uploadSession.sourceFileSize)
    ) {
      return ctx.json(
        {
          code: "BAD_REQUEST",
          message: "Uploaded avatar file exceeds the declared size limit.",
        },
        400,
      );
    }

    let normalized;
    try {
      normalized = await normalizeAvatarImage({
        bytes: uploadedObject.bytes,
        expectedContentType: uploadSession.sourceContentType,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Avatar image could not be processed.";
      return ctx.json({ code: "BAD_REQUEST", message }, 400);
    }
    const finalObjectKey = mediaService.buildFinalObjectKey({ subject });
    const stableMediaUrl = mediaService.buildStableMediaUrl({
      subject,
      versionToken: finalObjectKey,
    });

    await mediaService.putObject({
      objectKey: finalObjectKey,
      body: normalized.bytes,
      contentType: "image/webp",
      cacheControl: "private, max-age=31536000, immutable",
    });

    const previousObjectKey =
      subject.kind === "user"
        ? await updateUserAvatarState({
            ctx,
            userId: subject.userId,
            avatarKey: finalObjectKey,
            imageUrl: stableMediaUrl,
          })
        : await updateOrganizationLogoState({
            db,
            organizationId: subject.organizationId,
            logoKey: finalObjectKey,
            logoUrl: stableMediaUrl,
          });

    await db
      .update(ControlPlaneDbSchema.avatarUploadSessions)
      .set({
        finalizedAt: new Date(),
      })
      .where(eq(ControlPlaneDbSchema.avatarUploadSessions.id, uploadSession.id));

    if (previousObjectKey !== null) {
      await mediaService.deleteObject({ objectKey: previousObjectKey }).catch(() => undefined);
    }
    await mediaService
      .deleteObject({ objectKey: uploadSession.temporaryObjectKey })
      .catch(() => undefined);

    return ctx.json(
      {
        avatarUrl: stableMediaUrl,
      },
      200,
    );
  });

  routes.get("/users/:userId/avatar", async (ctx) => {
    const session = await requireAuthenticatedUserSession(ctx);
    if (session === null) {
      return ctx.json({ code: "UNAUTHORIZED", message: "Unauthorized API request." }, 401);
    }
    const userId = ctx.req.param("userId");
    const canRead = await canReadUserAvatar({
      db: ctx.get("db"),
      actorUserId: session.userId,
      targetUserId: userId,
    });
    if (!canRead) {
      return ctx.json({ code: "FORBIDDEN", message: "Forbidden API request." }, 403);
    }

    const user = await ctx.get("db").query.users.findFirst({
      columns: {
        avatarKey: true,
      },
      where: (table, { eq }) => eq(table.id, userId),
    });
    if (user === undefined || user.avatarKey === null) {
      return ctx.json({ code: "NOT_FOUND", message: "Avatar was not found." }, 404);
    }

    const signedReadUrl = await ctx.get("mediaService").getSignedReadUrl({
      objectKey: user.avatarKey,
      expiresAt: new Date(Date.now() + SignedReadTtlMs),
    });

    return ctx.redirect(signedReadUrl, 302);
  });

  routes.get("/organizations/:organizationId/logo", async (ctx) => {
    const session = await requireAuthenticatedUserSession(ctx);
    if (session === null) {
      return ctx.json({ code: "UNAUTHORIZED", message: "Unauthorized API request." }, 401);
    }
    const organizationId = ctx.req.param("organizationId");
    const canRead = await isOrganizationMember({
      db: ctx.get("db"),
      actorUserId: session.userId,
      organizationId,
    });
    if (!canRead) {
      return ctx.json({ code: "FORBIDDEN", message: "Forbidden API request." }, 403);
    }

    const organization = await ctx.get("db").query.organizations.findFirst({
      columns: {
        logoKey: true,
      },
      where: (table, { eq }) => eq(table.id, organizationId),
    });
    if (organization === undefined || organization.logoKey === null) {
      return ctx.json({ code: "NOT_FOUND", message: "Logo was not found." }, 404);
    }

    const signedReadUrl = await ctx.get("mediaService").getSignedReadUrl({
      objectKey: organization.logoKey,
      expiresAt: new Date(Date.now() + SignedReadTtlMs),
    });

    return ctx.redirect(signedReadUrl, 302);
  });

  routes.delete("/users/me/avatar", async (ctx) => {
    const session = await requireAuthenticatedUserSession(ctx);
    if (session === null) {
      return ctx.json({ code: "UNAUTHORIZED", message: "Unauthorized API request." }, 401);
    }
    const previousObjectKey = await updateUserAvatarState({
      ctx,
      userId: session.userId,
      avatarKey: null,
      imageUrl: null,
    });

    if (previousObjectKey !== null) {
      await ctx
        .get("mediaService")
        .deleteObject({ objectKey: previousObjectKey })
        .catch(() => undefined);
    }

    return ctx.json({ avatarUrl: null }, 200);
  });

  routes.delete("/organizations/:organizationId/logo", async (ctx) => {
    const session = await requireAuthenticatedUserSession(ctx);
    if (session === null) {
      return ctx.json({ code: "UNAUTHORIZED", message: "Unauthorized API request." }, 401);
    }
    const organizationId = ctx.req.param("organizationId");
    const canManage = await canManageOrganization({
      db: ctx.get("db"),
      actorUserId: session.userId,
      organizationId,
    });
    if (!canManage) {
      return ctx.json({ code: "FORBIDDEN", message: "Forbidden API request." }, 403);
    }

    const previousObjectKey = await updateOrganizationLogoState({
      db: ctx.get("db"),
      organizationId,
      logoKey: null,
      logoUrl: null,
    });

    if (previousObjectKey !== null) {
      await ctx
        .get("mediaService")
        .deleteObject({ objectKey: previousObjectKey })
        .catch(() => undefined);
    }

    return ctx.json({ avatarUrl: null }, 200);
  });

  return {
    basePath: MEDIA_ROUTE_BASE_PATH,
    routes,
  };
}

async function requireAuthenticatedUserSession(
  ctx: AppContext,
): Promise<AuthenticatedUserSession | null> {
  const session = await ctx.get("auth").api.getSession({
    headers: ctx.req.raw.headers,
  });

  if (
    typeof session !== "object" ||
    session === null ||
    typeof session.user !== "object" ||
    session.user === null ||
    typeof session.user.id !== "string" ||
    session.user.id.length === 0
  ) {
    return null;
  }

  return {
    userId: session.user.id,
  };
}

async function canManageOrganization(input: {
  db: AppContextBindings["Variables"]["db"];
  actorUserId: string;
  organizationId: string;
}): Promise<boolean> {
  const membership = await findOrganizationMembership(input);

  if (membership === undefined) {
    return false;
  }

  const role = parseOrganizationRole(membership.role);
  return role === "owner" || role === "admin";
}

async function isOrganizationMember(input: {
  db: AppContextBindings["Variables"]["db"];
  actorUserId: string;
  organizationId: string;
}): Promise<boolean> {
  const membership = await findOrganizationMembership(input);
  return membership !== undefined;
}

async function findOrganizationMembership(input: {
  db: AppContextBindings["Variables"]["db"];
  actorUserId: string;
  organizationId: string;
}) {
  const membership = await input.db.query.members.findFirst({
    columns: {
      role: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.organizationId, input.organizationId), eq(table.userId, input.actorUserId)),
  });

  if (membership === undefined) {
    return undefined;
  }

  return membership;
}

async function canReadUserAvatar(input: {
  db: AppContextBindings["Variables"]["db"];
  actorUserId: string;
  targetUserId: string;
}): Promise<boolean> {
  if (input.actorUserId === input.targetUserId) {
    return true;
  }

  const actorMemberships = await input.db.query.members.findMany({
    columns: {
      organizationId: true,
    },
    where: (table, { eq }) => eq(table.userId, input.actorUserId),
  });
  if (actorMemberships.length === 0) {
    return false;
  }

  const actorOrganizationIds = actorMemberships.map((membership) => membership.organizationId);
  const sharedMembership = await input.db.query.members.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.userId, input.targetUserId),
        inArray(table.organizationId, actorOrganizationIds),
      ),
  });

  return sharedMembership !== undefined;
}

async function normalizeAvatarImage(input: {
  bytes: Buffer;
  expectedContentType: string;
}): Promise<{ bytes: Buffer }> {
  if (!AvatarContentTypes.has(input.expectedContentType)) {
    throw new Error("Unsupported avatar content type.");
  }

  const image = sharp(input.bytes, {
    failOn: "error",
  }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width < MinAvatarDimension || height < MinAvatarDimension) {
    throw new Error("Avatar image dimensions are too small.");
  }

  const bytes = await image
    .resize({
      width: 512,
      height: 512,
      fit: "cover",
      withoutEnlargement: true,
    })
    .webp()
    .toBuffer();

  return {
    bytes,
  };
}

async function updateUserAvatarState(input: {
  ctx: AppContext;
  userId: string;
  avatarKey: string | null;
  imageUrl: string | null;
}): Promise<string | null> {
  const db = input.ctx.get("db");
  const previousUser = await db.query.users.findFirst({
    columns: {
      avatarKey: true,
    },
    where: (table, { eq }) => eq(table.id, input.userId),
  });
  if (previousUser === undefined) {
    throw new Error("User was not found.");
  }

  await db
    .update(ControlPlaneDbSchema.users)
    .set({
      avatarKey: input.avatarKey,
      image: input.imageUrl,
      updatedAt: new Date(),
    })
    .where(eq(ControlPlaneDbSchema.users.id, input.userId));

  return previousUser.avatarKey;
}

async function updateOrganizationLogoState(input: {
  db: AppContextBindings["Variables"]["db"];
  organizationId: string;
  logoKey: string | null;
  logoUrl: string | null;
}): Promise<string | null> {
  const previousOrganization = await input.db.query.organizations.findFirst({
    columns: {
      logoKey: true,
    },
    where: (table, { eq }) => eq(table.id, input.organizationId),
  });
  if (previousOrganization === undefined) {
    throw new Error("Organization was not found.");
  }

  await input.db
    .update(ControlPlaneDbSchema.organizations)
    .set({
      logoKey: input.logoKey,
      logo: input.logoUrl,
    })
    .where(eq(ControlPlaneDbSchema.organizations.id, input.organizationId));

  return previousOrganization.logoKey;
}
