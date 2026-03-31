import { requestControlPlane } from "../../api/request-control-plane.js";
import { executeMembersOperation } from "../members/members-api-errors.js";

type UnknownRecord = Record<string, unknown>;

type MediaSubject =
  | {
      kind: "user";
      id: string;
    }
  | {
      kind: "organization";
      id: string;
    };

type DirectUploadInstruction = {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
};

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

function readDirectUploadInstruction(value: unknown): DirectUploadInstruction {
  const upload = toRecord(value);
  if (upload === null) {
    throw new Error("Upload instructions were invalid.");
  }

  const method = readString(upload, "method");
  const url = readString(upload, "url");
  const headersValue = toRecord(upload["headers"]);

  if (method !== "PUT" || url === null || headersValue === null) {
    throw new Error("Upload instructions were incomplete.");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(headersValue)) {
    if (typeof value !== "string") {
      throw new Error("Upload headers were invalid.");
    }
    headers[key] = value;
  }

  return {
    method,
    url,
    headers,
  };
}

function readUploadSessionResponse(value: unknown): {
  uploadSessionId: string;
  upload: DirectUploadInstruction;
} {
  const payload = toRecord(value);
  if (payload === null) {
    throw new Error("Upload session response was invalid.");
  }

  const uploadSessionId = readString(payload, "uploadSessionId");
  if (uploadSessionId === null) {
    throw new Error("Upload session id was missing.");
  }

  return {
    uploadSessionId,
    upload: readDirectUploadInstruction(payload["upload"]),
  };
}

function readAvatarResponse(value: unknown): { avatarUrl: string | null } {
  const payload = toRecord(value);
  if (payload === null) {
    throw new Error("Avatar response was invalid.");
  }

  const avatarUrl = payload["avatarUrl"];
  if (avatarUrl !== null && typeof avatarUrl !== "string") {
    throw new Error("Avatar response contained an invalid URL.");
  }

  return {
    avatarUrl,
  };
}

async function createAvatarUploadSession(input: {
  file: File;
  subject: MediaSubject;
}): Promise<{ uploadSessionId: string; upload: DirectUploadInstruction }> {
  if (input.file.type.trim().length === 0) {
    throw new Error("Avatar uploads require a valid image content type.");
  }

  const response = await requestControlPlane({
    operation: "createAvatarUploadSession",
    basePath: "/v1/media",
    pathname: "/avatar-upload-sessions",
    method: "POST",
    fallbackMessage: "Could not start avatar upload.",
    body: {
      subject: input.subject,
      contentType: input.file.type,
      fileSize: input.file.size,
      fileName: input.file.name,
    },
  });

  return readUploadSessionResponse(await response.json());
}

async function uploadFileToObjectStorage(input: {
  file: File;
  upload: DirectUploadInstruction;
}): Promise<void> {
  const response = await fetch(input.upload.url, {
    method: input.upload.method,
    headers: input.upload.headers,
    body: input.file,
  });

  if (!response.ok) {
    throw new Error("Could not upload avatar file.");
  }
}

async function finalizeAvatarUpload(input: {
  uploadSessionId: string;
}): Promise<{ avatarUrl: string | null }> {
  const response = await requestControlPlane({
    operation: "finalizeAvatarUpload",
    basePath: "/v1/media",
    pathname: "/avatar-upload-sessions/finalize",
    method: "POST",
    fallbackMessage: "Could not finalize avatar upload.",
    body: {
      uploadSessionId: input.uploadSessionId,
    },
  });

  return readAvatarResponse(await response.json());
}

async function uploadAvatarFile(input: {
  file: File;
  subject: MediaSubject;
}): Promise<{ avatarUrl: string | null }> {
  const uploadSession = await createAvatarUploadSession(input);
  await uploadFileToObjectStorage({
    file: input.file,
    upload: uploadSession.upload,
  });

  return finalizeAvatarUpload({
    uploadSessionId: uploadSession.uploadSessionId,
  });
}

export async function uploadUserAvatar(input: {
  userId: string;
  file: File;
}): Promise<{ avatarUrl: string | null }> {
  return executeMembersOperation("uploadUserAvatar", async () =>
    uploadAvatarFile({
      file: input.file,
      subject: {
        kind: "user",
        id: input.userId,
      },
    }),
  );
}

export async function deleteUserAvatar(): Promise<{ avatarUrl: string | null }> {
  return executeMembersOperation("deleteUserAvatar", async () => {
    const response = await requestControlPlane({
      operation: "deleteUserAvatar",
      basePath: "/v1/media",
      pathname: "/users/me/avatar",
      method: "DELETE",
      fallbackMessage: "Could not remove avatar.",
    });

    return readAvatarResponse(await response.json());
  });
}

export async function uploadOrganizationLogo(input: {
  organizationId: string;
  file: File;
}): Promise<{ avatarUrl: string | null }> {
  return executeMembersOperation("uploadOrganizationLogo", async () =>
    uploadAvatarFile({
      file: input.file,
      subject: {
        kind: "organization",
        id: input.organizationId,
      },
    }),
  );
}

export async function deleteOrganizationLogo(input: {
  organizationId: string;
}): Promise<{ avatarUrl: string | null }> {
  return executeMembersOperation("deleteOrganizationLogo", async () => {
    const response = await requestControlPlane({
      operation: "deleteOrganizationLogo",
      basePath: "/v1/media",
      pathname: `/organizations/${encodeURIComponent(input.organizationId)}/logo`,
      method: "DELETE",
      fallbackMessage: "Could not remove organization logo.",
    });

    return readAvatarResponse(await response.json());
  });
}
