# @mistle/object-store

Shared S3-compatible object storage primitives for Mistle.

Use this package instead of wiring AWS SDK S3 clients directly in app code. It
provides a small storage boundary that binds a bucket and exposes a narrow
subset of S3-compatible operations while staying close to the underlying AWS SDK
response types.

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `ObjectStore`
- `PutObjectInput`
- `ReadObjectInput`
- `HeadObjectInput`
- `DeleteObjectInput`
- `S3CompatibleObjectStore`
- `S3CompatibleObjectStoreConfig`

## Usage

```ts
import { S3CompatibleObjectStore } from "@mistle/object-store";

const objectStore = new S3CompatibleObjectStore({
  bucketName: "mistle-media",
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
  body: new TextEncoder().encode("hello"),
  contentType: "image/webp",
});

const object = await objectStore.readObject({
  objectKey: "avatars/users/usr_123/avatar.webp",
});

const bytes = await object.Body?.transformToByteArray();

await objectStore.deleteObject({
  objectKey: "avatars/users/usr_123/avatar.webp",
});
```

## Design Constraints

- S3-compatible storage only for now.
- Application code should depend on the `ObjectStore` interface, not AWS SDK
  commands directly.
- Provider-specific details should stay inside this package.
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
