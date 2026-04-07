import { MemberRoles, members, organizations, sessions } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { createControlPlaneApiRuntime } from "../src/main.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

const IntegrationConnectionTokenConfig = {
  secret: "integration-connection-secret",
  issuer: "integration-issuer",
  audience: "integration-audience",
} as const;

const IntegrationSandboxRuntimeConfig = {
  defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
  gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
} as const;

describe("organization logo endpoints integration", () => {
  it("returns null from the authenticated read endpoint when no logo is stored", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-read-empty@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });

    try {
      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(authenticatedSession.organizationId)}/logo`,
        {
          method: "GET",
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        imageUrl: null,
      });
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("uploads an organization logo through the authenticated endpoint and returns a signed read URL", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-upload@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });

    try {
      const sourceImage = await sharp({
        create: {
          width: 960,
          height: 640,
          channels: 3,
          background: {
            r: 24,
            g: 96,
            b: 220,
          },
        },
      })
        .jpeg()
        .toBuffer();
      const formData = new FormData();

      formData.set(
        "file",
        new File([new Uint8Array(sourceImage)], "logo.jpg", { type: "image/jpeg" }),
      );

      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(authenticatedSession.organizationId)}/logo`,
        {
          method: "PUT",
          headers: {
            cookie: authenticatedSession.cookie,
          },
          body: formData,
        },
      );

      expect(response.status).toBe(200);

      const payload: unknown = await response.json();
      const imageUrl = readImageUrl(payload);

      expect(imageUrl).not.toBeNull();

      const persistedOrganization = await runtime.db.query.organizations.findFirst({
        columns: {
          logoObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.organizationId),
      });

      expect(persistedOrganization?.logoObjectKey).toMatch(
        new RegExp(
          `^logos/organizations/${authenticatedSession.organizationId}/img_[^/]+\\.webp$`,
          "u",
        ),
      );

      if (imageUrl === null) {
        throw new Error("Expected organization logo response to include imageUrl.");
      }

      const imageResponse = await fetch(imageUrl);

      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/webp");

      const imageMetadata = await sharp(await imageResponse.bytes()).metadata();

      expect(imageMetadata.format).toBe("webp");
      expect(imageMetadata.width).toBe(512);
      expect(imageMetadata.height).toBe(512);
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns a validation error when the multipart body is missing the file field", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-validation@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });

    try {
      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(authenticatedSession.organizationId)}/logo`,
        {
          method: "PUT",
          headers: {
            cookie: authenticatedSession.cookie,
          },
          body: new FormData(),
        },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
      });
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("deletes the uploaded organization logo through the authenticated endpoint", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-delete@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });
    const objectStore = createTestObjectStore(seaweedfs);
    const previousObjectKey = `logos/organizations/${authenticatedSession.organizationId}/img_previous.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: previousObjectKey,
      });
      await runtime.db
        .update(organizations)
        .set({
          logoObjectKey: previousObjectKey,
        })
        .where(eq(organizations.id, authenticatedSession.organizationId));

      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(authenticatedSession.organizationId)}/logo`,
        {
          method: "DELETE",
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");

      const persistedOrganization = await runtime.db.query.organizations.findFirst({
        columns: {
          logoObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.organizationId),
      });

      expect(persistedOrganization).toEqual({
        logoObjectKey: null,
      });

      await expect(objectStore.headObject(previousObjectKey)).rejects.toMatchObject({
        name: "NotFound",
      });
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns a signed read URL from the authenticated read endpoint when a logo exists", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-read-existing@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });
    const objectStore = createTestObjectStore(seaweedfs);
    const objectKey = `logos/organizations/${authenticatedSession.organizationId}/img_existing.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey,
      });
      await runtime.db
        .update(organizations)
        .set({
          logoObjectKey: objectKey,
        })
        .where(eq(organizations.id, authenticatedSession.organizationId));

      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(authenticatedSession.organizationId)}/logo`,
        {
          method: "GET",
          headers: {
            cookie: authenticatedSession.cookie,
          },
        },
      );

      expect(response.status).toBe(200);

      const payload: unknown = await response.json();
      const imageUrl = readImageUrl(payload);

      expect(imageUrl).not.toBeNull();

      if (imageUrl === null) {
        throw new Error("Expected organization logo read response to include imageUrl.");
      }

      const imageResponse = await fetch(imageUrl);

      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/webp");
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns forbidden when the request targets a different organization than the active session organization", async ({
    fixture,
  }) => {
    const firstSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-forbidden-first@example.com",
    });
    const secondSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-forbidden-second@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });

    try {
      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(firstSession.organizationId)}/logo`,
        {
          method: "GET",
          headers: {
            cookie: secondSession.cookie,
          },
        },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        code: "FORBIDDEN",
        message: "Forbidden API request.",
      });
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns forbidden when a same-organization member tries to upload a logo", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-member-upload-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-member-upload-member@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });

    try {
      await addMemberToActiveOrganization({
        fixture,
        organizationId: ownerSession.organizationId,
        userId: memberSession.userId,
      });

      const sourceImage = await sharp({
        create: {
          width: 960,
          height: 640,
          channels: 3,
          background: {
            r: 24,
            g: 96,
            b: 220,
          },
        },
      })
        .jpeg()
        .toBuffer();
      const formData = new FormData();

      formData.set(
        "file",
        new File([new Uint8Array(sourceImage)], "logo.jpg", { type: "image/jpeg" }),
      );

      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/logo`,
        {
          method: "PUT",
          headers: {
            cookie: memberSession.cookie,
          },
          body: formData,
        },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        code: "FORBIDDEN",
        message: "Forbidden API request.",
      });
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns forbidden when a same-organization member tries to delete a logo", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-member-delete-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "integration-organization-logo-endpoint-member-delete-member@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });
    const objectStore = createTestObjectStore(seaweedfs);
    const objectKey = `logos/organizations/${ownerSession.organizationId}/img_existing.webp`;

    try {
      await addMemberToActiveOrganization({
        fixture,
        organizationId: ownerSession.organizationId,
        userId: memberSession.userId,
      });
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey,
      });
      await runtime.db
        .update(organizations)
        .set({
          logoObjectKey: objectKey,
        })
        .where(eq(organizations.id, ownerSession.organizationId));

      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/logo`,
        {
          method: "DELETE",
          headers: {
            cookie: memberSession.cookie,
          },
        },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        code: "FORBIDDEN",
        message: "Forbidden API request.",
      });

      const persistedOrganization = await runtime.db.query.organizations.findFirst({
        columns: {
          logoObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, ownerSession.organizationId),
      });

      expect(persistedOrganization).toEqual({
        logoObjectKey: objectKey,
      });
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });
});

async function createRuntimeWithObjectStore(input: {
  config: ControlPlaneApiConfig;
  internalAuthServiceToken: string;
  seaweedfs: Awaited<ReturnType<typeof startSeaweedfsS3>>;
}) {
  return createControlPlaneApiRuntime({
    app: {
      ...input.config,
      objectStore: {
        bucketName: input.seaweedfs.bucketName,
        region: input.seaweedfs.region,
        endpoint: input.seaweedfs.endpoint,
        forcePathStyle: true,
        accessKeyId: input.seaweedfs.accessKeyId,
        secretAccessKey: input.seaweedfs.secretAccessKey,
      },
    },
    internalAuthServiceToken: input.internalAuthServiceToken,
    connectionToken: IntegrationConnectionTokenConfig,
    sandbox: IntegrationSandboxRuntimeConfig,
  });
}

function readImageUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  if (!("imageUrl" in payload) || typeof payload.imageUrl !== "string") {
    return null;
  }

  return payload.imageUrl;
}

async function addMemberToActiveOrganization(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.fixture.db.insert(members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: MemberRoles.MEMBER,
  });

  await input.fixture.db
    .update(sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(sessions.userId, input.userId));
}
