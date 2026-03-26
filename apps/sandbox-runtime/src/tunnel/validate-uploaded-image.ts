import { open } from "node:fs/promises";

import { FileUploadResetCodes, type FileUploadResetCode } from "@mistle/sandbox-session-protocol";

const SignatureReadLengthBytes = 12;

export const ImageSignatures = {
  GIF87A: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
  GIF89A: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  JPEG: new Uint8Array([0xff, 0xd8, 0xff]),
  PNG: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  WEBP_BRAND: new Uint8Array([0x57, 0x45, 0x42, 0x50]),
  WEBP_RIFF: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
} as const;

// This upload-time screening is intentionally lightweight. It checks for a
// supported image signature and declared MIME agreement only. It does not
// perform full structural parsing or decode validation, so downstream image
// consumers may still reject malformed or truncated files that pass here.
function matchesBytes(input: {
  bytes: Uint8Array;
  offset?: number;
  signature: Uint8Array;
}): boolean {
  const offset = input.offset ?? 0;
  if (input.bytes.byteLength < offset + input.signature.length) {
    return false;
  }

  return input.signature.every((value, index) => input.bytes[offset + index] === value);
}

export function detectSupportedImageMimeType(bytes: Uint8Array): string | null {
  if (
    matchesBytes({
      bytes,
      signature: ImageSignatures.PNG,
    })
  ) {
    return "image/png";
  }

  if (
    matchesBytes({
      bytes,
      signature: ImageSignatures.JPEG,
    })
  ) {
    return "image/jpeg";
  }

  if (
    matchesBytes({
      bytes,
      signature: ImageSignatures.GIF87A,
    }) ||
    matchesBytes({
      bytes,
      signature: ImageSignatures.GIF89A,
    })
  ) {
    return "image/gif";
  }

  if (
    matchesBytes({
      bytes,
      signature: ImageSignatures.WEBP_RIFF,
    }) &&
    matchesBytes({
      bytes,
      offset: 8,
      signature: ImageSignatures.WEBP_BRAND,
    })
  ) {
    return "image/webp";
  }

  return null;
}

type ImageValidationResult =
  | {
      ok: true;
      detectedMimeType: string;
    }
  | {
      ok: false;
      code: FileUploadResetCode;
      message: string;
    };

export async function validateUploadedImage(input: {
  declaredMimeType: string;
  tempPath: string;
}): Promise<ImageValidationResult> {
  const fileHandle = await open(input.tempPath, "r");

  try {
    const signatureBytes = new Uint8Array(SignatureReadLengthBytes);
    const readResult = await fileHandle.read(signatureBytes, 0, SignatureReadLengthBytes, 0);
    const detectedMimeType = detectSupportedImageMimeType(
      signatureBytes.subarray(0, readResult.bytesRead),
    );

    if (detectedMimeType === null) {
      return {
        ok: false,
        code: FileUploadResetCodes.INVALID_FILE_TYPE,
        message: "Uploaded file is not a supported image.",
      };
    }

    if (detectedMimeType !== input.declaredMimeType) {
      return {
        ok: false,
        code: FileUploadResetCodes.MIME_TYPE_MISMATCH,
        message: `Uploaded file content is '${detectedMimeType}', which does not match declared MIME type '${input.declaredMimeType}'.`,
      };
    }

    return {
      ok: true,
      detectedMimeType,
    };
  } finally {
    await fileHandle.close();
  }
}
