import { getDashboardConfig } from "../../../config.js";
import { authClient } from "../../../lib/auth/client.js";
import { requestControlPlane } from "../../api/request-control-plane.js";
import {
  assertSingletonImageHasVersion,
  readSingletonImageMetadataResponse,
  type SingletonImageMetadata,
} from "../../shared/singleton-image.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

function createProfileImageUrl(): URL {
  const config = getDashboardConfig();
  return new URL("/v1/me/profile-image", config.controlPlaneApiOrigin);
}

export async function getProfileImage(): Promise<SingletonImageMetadata> {
  return executeMembersOperation("getProfileImage", async () => {
    const response = await requestControlPlane({
      operation: "getProfileImage",
      pathname: "/v1/me/profile-image",
      method: "GET",
      fallbackMessage: "Could not load profile image.",
    });

    return readSingletonImageMetadataResponse({
      response,
      resourceName: "Profile image",
    });
  });
}

export async function uploadProfileImage(input: { file: File }): Promise<SingletonImageMetadata> {
  return executeMembersOperation("uploadProfileImage", async () => {
    const formData = new FormData();
    formData.set("file", input.file);

    const response = await fetch(createProfileImageUrl(), {
      method: "PUT",
      credentials: "include",
      headers: {
        accept: "application/json",
      },
      body: formData,
    });

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new Error(
        typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof payload.message === "string"
          ? payload.message
          : "Could not upload profile image.",
      );
    }

    const result = await readSingletonImageMetadataResponse({
      response,
      resourceName: "Profile image",
    });
    assertSingletonImageHasVersion({
      image: result,
      resourceName: "Profile image",
    });

    return result;
  });
}

export async function deleteProfileImage(): Promise<void> {
  return executeMembersOperation("deleteProfileImage", async () => {
    const response = await requestControlPlane({
      operation: "deleteProfileImage",
      pathname: "/v1/me/profile-image",
      method: "DELETE",
      fallbackMessage: "Could not delete profile image.",
    });

    await response.text();
  });
}

export async function updateProfileDisplayName(input: { displayName: string }): Promise<void> {
  return executeMembersOperation("updateProfileDisplayName", async () => {
    await authClient.$fetch("/update-user", {
      method: "POST",
      throw: true,
      body: {
        name: input.displayName,
      },
    });
  });
}
