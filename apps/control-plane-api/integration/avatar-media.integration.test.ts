import { Buffer } from "node:buffer";

import { GetObjectCommand, HeadObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { it } from "./test-context.js";

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record: UnknownRecord = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNullableString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : null;
}

function readUploadPayload(value: unknown): {
  uploadSessionId: string;
  uploadUrl: string;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
} {
  const payload = toRecord(value);
  if (payload === null) {
    throw new Error("Upload payload was invalid.");
  }

  const uploadSessionId = readString(payload, "uploadSessionId");
  const upload = toRecord(payload["upload"]);
  const uploadUrl = upload === null ? null : readString(upload, "url");
  const uploadMethod = upload === null ? null : readString(upload, "method");
  const headersRecord = upload === null ? null : toRecord(upload["headers"]);

  if (
    uploadSessionId === null ||
    uploadUrl === null ||
    uploadMethod === null ||
    headersRecord === null
  ) {
    throw new Error("Upload payload was incomplete.");
  }

  const uploadHeaders: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(headersRecord)) {
    if (typeof headerValue !== "string") {
      throw new Error("Upload headers were invalid.");
    }
    uploadHeaders[key] = headerValue;
  }

  return {
    uploadSessionId,
    uploadUrl,
    uploadMethod,
    uploadHeaders,
  };
}

function readAvatarUrl(value: unknown): string | null {
  const payload = toRecord(value);
  if (payload === null) {
    throw new Error("Avatar payload was invalid.");
  }

  return readNullableString(payload, "avatarUrl");
}

function readSessionUserImage(value: unknown): string | null {
  const payload = toRecord(value);
  const user = payload === null ? null : toRecord(payload["user"]);
  if (user === null) {
    throw new Error("Session payload was invalid.");
  }

  return readNullableString(user, "image");
}

function readOrganizationLogo(value: unknown): string | null {
  const payload = toRecord(value);
  if (payload === null) {
    throw new Error("Organization payload was invalid.");
  }

  return readNullableString(payload, "logo");
}

function createStorageClient(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): S3Client {
  return new S3Client({
    region: "us-east-1",
    endpoint: input.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
}

async function createPngBuffer(input: { width: number; height: number }): Promise<Buffer> {
  return sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 3,
      background: {
        r: 24,
        g: 87,
        b: 173,
      },
    },
  })
    .png()
    .toBuffer();
}

async function uploadDirectObject(input: {
  uploadUrl: string;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
  body: Buffer;
}): Promise<void> {
  const response = await fetch(input.uploadUrl, {
    method: input.uploadMethod,
    headers: input.uploadHeaders,
    body: new Uint8Array(input.body),
  });

  expect(response.status).toBeLessThan(400);
}

async function objectExists(input: {
  client: S3Client;
  bucket: string;
  objectKey: string;
}): Promise<boolean> {
  try {
    await input.client.send(
      new HeadObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof NoSuchKey) {
      return false;
    }

    if (error instanceof Error && error.name === "NotFound") {
      return false;
    }

    throw error;
  }
}

async function readStoredObjectContentType(input: {
  client: S3Client;
  bucket: string;
  objectKey: string;
}): Promise<string | null> {
  const response = await input.client.send(
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
    }),
  );

  return response.ContentType ?? null;
}

describe("avatar media integration", () => {
  it("uploads, serves, and deletes user avatars while keeping session state consistent", async ({
    fixture,
  }) => {
    const authSession = await fixture.authSession({
      email: "integration-avatar-user@example.com",
    });
    const mediaConfig = fixture.config.media;
    if (mediaConfig.provider !== "s3") {
      throw new Error("Integration avatar media tests require the s3 provider.");
    }
    if (mediaConfig.s3 === undefined) {
      throw new Error("Integration avatar media tests require s3 config.");
    }
    const storageClient = createStorageClient({
      endpoint: mediaConfig.s3.endpoint ?? "",
      accessKeyId: mediaConfig.s3.accessKeyId,
      secretAccessKey: mediaConfig.s3.secretAccessKey,
    });

    const createResponse = await fixture.request("/v1/media/avatar-upload-sessions", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: {
          kind: "user",
          id: authSession.userId,
        },
        contentType: "image/png",
        fileSize: 2048,
        fileName: "avatar.png",
      }),
    });

    expect(createResponse.status).toBe(200);
    const upload = readUploadPayload(await createResponse.json());
    const sourceImage = await createPngBuffer({
      width: 256,
      height: 256,
    });

    await uploadDirectObject({
      uploadUrl: upload.uploadUrl,
      uploadMethod: upload.uploadMethod,
      uploadHeaders: upload.uploadHeaders,
      body: sourceImage,
    });

    const finalizeResponse = await fixture.request("/v1/media/avatar-upload-sessions/finalize", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uploadSessionId: upload.uploadSessionId,
      }),
    });

    expect(finalizeResponse.status).toBe(200);
    const avatarUrl = readAvatarUrl(await finalizeResponse.json());
    expect(avatarUrl).toBe(
      `${fixture.config.media.mediaBaseUrl}/v1/media/users/${authSession.userId}/avatar`,
    );

    const userRow = await fixture.db.query.users.findFirst({
      columns: {
        avatarKey: true,
        image: true,
      },
      where: (table, { eq }) => eq(table.id, authSession.userId),
    });
    expect(userRow?.avatarKey).not.toBeNull();
    expect(userRow?.image).toBe(avatarUrl);

    if (userRow?.avatarKey === null || userRow?.avatarKey === undefined) {
      throw new Error("Expected uploaded avatar key to be stored.");
    }

    expect(
      await objectExists({
        client: storageClient,
        bucket: mediaConfig.bucket,
        objectKey: userRow.avatarKey,
      }),
    ).toBe(true);
    expect(
      await readStoredObjectContentType({
        client: storageClient,
        bucket: mediaConfig.bucket,
        objectKey: userRow.avatarKey,
      }),
    ).toBe("image/webp");

    const sessionResponse = await fixture.request("/v1/auth/get-session", {
      headers: {
        cookie: authSession.cookie,
      },
    });
    expect(sessionResponse.status).toBe(200);
    expect(readSessionUserImage(await sessionResponse.json())).toBe(avatarUrl);

    const mediaRedirect = await fixture.request(`/v1/media/users/${authSession.userId}/avatar`, {
      headers: {
        cookie: authSession.cookie,
      },
    });
    expect(mediaRedirect.status).toBe(302);
    expect(mediaRedirect.headers.get("location")).toContain(mediaConfig.bucket);

    const unauthorizedRead = await fixture.request(`/v1/media/users/${authSession.userId}/avatar`);
    expect(unauthorizedRead.status).toBe(401);

    const deleteResponse = await fixture.request("/v1/media/users/me/avatar", {
      method: "DELETE",
      headers: {
        cookie: authSession.cookie,
      },
    });
    expect(deleteResponse.status).toBe(200);
    expect(readAvatarUrl(await deleteResponse.json())).toBeNull();

    const userAfterDelete = await fixture.db.query.users.findFirst({
      columns: {
        avatarKey: true,
        image: true,
      },
      where: (table, { eq }) => eq(table.id, authSession.userId),
    });
    expect(userAfterDelete).toEqual({
      avatarKey: null,
      image: null,
    });

    const sessionAfterDeleteResponse = await fixture.request("/v1/auth/get-session", {
      headers: {
        cookie: authSession.cookie,
      },
    });
    expect(sessionAfterDeleteResponse.status).toBe(200);
    expect(readSessionUserImage(await sessionAfterDeleteResponse.json())).toBeNull();

    expect(
      await objectExists({
        client: storageClient,
        bucket: mediaConfig.bucket,
        objectKey: userRow.avatarKey,
      }),
    ).toBe(false);
  });

  it("uploads, serves, and deletes organization logos while keeping org reads consistent", async ({
    fixture,
  }) => {
    const authSession = await fixture.authSession({
      email: "integration-avatar-org@example.com",
    });

    const createResponse = await fixture.request("/v1/media/avatar-upload-sessions", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: {
          kind: "organization",
          id: authSession.organizationId,
        },
        contentType: "image/png",
        fileSize: 2048,
        fileName: "logo.png",
      }),
    });

    expect(createResponse.status).toBe(200);
    const upload = readUploadPayload(await createResponse.json());

    await uploadDirectObject({
      uploadUrl: upload.uploadUrl,
      uploadMethod: upload.uploadMethod,
      uploadHeaders: upload.uploadHeaders,
      body: await createPngBuffer({
        width: 256,
        height: 256,
      }),
    });

    const finalizeResponse = await fixture.request("/v1/media/avatar-upload-sessions/finalize", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uploadSessionId: upload.uploadSessionId,
      }),
    });

    expect(finalizeResponse.status).toBe(200);
    const logoUrl = readAvatarUrl(await finalizeResponse.json());
    expect(logoUrl).toBe(
      `${fixture.config.media.mediaBaseUrl}/v1/media/organizations/${authSession.organizationId}/logo`,
    );

    const organizationRow = await fixture.db.query.organizations.findFirst({
      columns: {
        logoKey: true,
        logo: true,
      },
      where: (table, { eq }) => eq(table.id, authSession.organizationId),
    });
    expect(organizationRow?.logoKey).not.toBeNull();
    expect(organizationRow?.logo).toBe(logoUrl);

    const organizationResponse = await fixture.request(
      `/v1/auth/organization/get-full-organization?organizationId=${encodeURIComponent(authSession.organizationId)}`,
      {
        headers: {
          cookie: authSession.cookie,
        },
      },
    );
    expect(organizationResponse.status).toBe(200);
    expect(readOrganizationLogo(await organizationResponse.json())).toBe(logoUrl);

    const mediaRedirect = await fixture.request(
      `/v1/media/organizations/${authSession.organizationId}/logo`,
      {
        headers: {
          cookie: authSession.cookie,
        },
      },
    );
    expect(mediaRedirect.status).toBe(302);

    const deleteResponse = await fixture.request(
      `/v1/media/organizations/${authSession.organizationId}/logo`,
      {
        method: "DELETE",
        headers: {
          cookie: authSession.cookie,
        },
      },
    );
    expect(deleteResponse.status).toBe(200);
    expect(readAvatarUrl(await deleteResponse.json())).toBeNull();

    const organizationAfterDelete = await fixture.db.query.organizations.findFirst({
      columns: {
        logoKey: true,
        logo: true,
      },
      where: (table, { eq }) => eq(table.id, authSession.organizationId),
    });
    expect(organizationAfterDelete).toEqual({
      logoKey: null,
      logo: null,
    });
  });

  it("rejects finalize for images smaller than the minimum dimension", async ({ fixture }) => {
    const authSession = await fixture.authSession({
      email: "integration-avatar-small@example.com",
    });

    const createResponse = await fixture.request("/v1/media/avatar-upload-sessions", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: {
          kind: "user",
          id: authSession.userId,
        },
        contentType: "image/png",
        fileSize: 512,
        fileName: "small.png",
      }),
    });
    expect(createResponse.status).toBe(200);
    const upload = readUploadPayload(await createResponse.json());

    await uploadDirectObject({
      uploadUrl: upload.uploadUrl,
      uploadMethod: upload.uploadMethod,
      uploadHeaders: upload.uploadHeaders,
      body: await createPngBuffer({
        width: 64,
        height: 64,
      }),
    });

    const finalizeResponse = await fixture.request("/v1/media/avatar-upload-sessions/finalize", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uploadSessionId: upload.uploadSessionId,
      }),
    });
    expect(finalizeResponse.status).toBe(400);

    const payload = toRecord(await finalizeResponse.json());
    expect(readString(payload ?? {}, "message")).toBe("Avatar image dimensions are too small.");

    const userRow = await fixture.db.query.users.findFirst({
      columns: {
        avatarKey: true,
        image: true,
      },
      where: (table, { eq }) => eq(table.id, authSession.userId),
    });
    expect(userRow).toEqual({
      avatarKey: null,
      image: null,
    });
  });

  it("rejects finalize when uploaded bytes are not a valid image", async ({ fixture }) => {
    const authSession = await fixture.authSession({
      email: "integration-avatar-invalid-bytes@example.com",
    });

    const createResponse = await fixture.request("/v1/media/avatar-upload-sessions", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: {
          kind: "user",
          id: authSession.userId,
        },
        contentType: "image/png",
        fileSize: 19,
        fileName: "not-an-image.png",
      }),
    });
    expect(createResponse.status).toBe(200);
    const upload = readUploadPayload(await createResponse.json());

    await uploadDirectObject({
      uploadUrl: upload.uploadUrl,
      uploadMethod: upload.uploadMethod,
      uploadHeaders: upload.uploadHeaders,
      body: Buffer.from("not-a-real-image-file", "utf8"),
    });

    const finalizeResponse = await fixture.request("/v1/media/avatar-upload-sessions/finalize", {
      method: "POST",
      headers: {
        cookie: authSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uploadSessionId: upload.uploadSessionId,
      }),
    });
    expect(finalizeResponse.status).toBe(400);

    const payload = toRecord(await finalizeResponse.json());
    expect(readString(payload ?? {}, "code")).toBe("BAD_REQUEST");

    const uploadSessionRow = await fixture.db.query.avatarUploadSessions.findFirst({
      columns: {
        finalizedAt: true,
      },
      where: (table, { eq }) => eq(table.id, upload.uploadSessionId),
    });
    expect(uploadSessionRow?.finalizedAt).toBeNull();
  });
});
