# @mistle/object-store

Shared S3-compatible object storage primitives for Mistle.

Use this package instead of wiring AWS SDK S3 clients directly in app code. It
provides a bucket-bound S3-compatible client that exposes a narrow subset of
operations while staying close to the underlying AWS SDK response types.

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `PutObjectInput`
- `CreatePresignedGetUrlInput`
- `S3CompatibleObjectStore`
- `S3CompatibleObjectStoreConfig`

## Usage

```ts
import { S3CompatibleObjectStore } from "@mistle/object-store";

const objectStore = new S3CompatibleObjectStore({
  bucketName: "mistle-assets",
  region: "us-east-1",
  endpoint: "http://127.0.0.1:8333",
  forcePathStyle: true,
  credentials: {
    accessKeyId: "mistle-access-key",
    secretAccessKey: "mistle-secret-key",
  },
});

await objectStore.putObject({
  objectKey: "avatars/users/usr_123/avatar.webp",
  Body: new TextEncoder().encode("hello"),
  ContentType: "image/webp",
});

const object = await objectStore.readObject("avatars/users/usr_123/avatar.webp");

const bytes = await object.Body?.transformToByteArray();

const presignedGetUrl = await objectStore.createPresignedGetUrl({
  objectKey: "avatars/users/usr_123/avatar.webp",
  expiresInSeconds: 300,
});

await objectStore.deleteObject("avatars/users/usr_123/avatar.webp");

objectStore.destroy();
```

## Design Constraints

- S3-compatible storage only for now.
- Application code should depend on `S3CompatibleObjectStore` rather than
  wiring raw S3 commands directly throughout the codebase.
- Bucket binding and S3-compatible client wiring should stay inside this
  package.
- This package keeps its method surface small, but it surfaces backend-native
  S3-compatible errors and stays close to the underlying S3 command outputs.

## Testing

Integration coverage for this package runs against a real SeaweedFS container
through `@mistle/test-harness`.

Commands:

- `pnpm --filter @mistle/object-store test`
- `pnpm --filter @mistle/object-store test:integration`
- `pnpm --filter @mistle/object-store lint`
- `pnpm --filter @mistle/object-store typecheck`
