# @mistle/object-store

Shared S3-compatible object storage primitives for Mistle.

Use this package instead of wiring AWS SDK S3 clients directly in app code. It
provides a small storage boundary that later application code can depend on
without leaking provider-specific commands and response types across the
workspace.

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `ObjectStore`
- `PutObjectInput`
- `ReadObjectInput`
- `ReadObjectResult`
- `HeadObjectInput`
- `HeadObjectResult`
- `DeleteObjectInput`
- `ObjectStoreObjectNotFoundError`
- `S3CompatibleObjectStore`
- `S3CompatibleObjectStoreConfig`
- `createS3CompatibleObjectStore(...)`

## Usage

```ts
import { createS3CompatibleObjectStore } from "@mistle/object-store";

const objectStore = createS3CompatibleObjectStore({
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

await objectStore.deleteObject({
  objectKey: "avatars/users/usr_123/avatar.webp",
});
```

## Design Constraints

- S3-compatible storage only for now.
- Application code should depend on the `ObjectStore` interface, not AWS SDK
  commands directly.
- Provider-specific details should stay inside this package.
- Missing objects should fail explicitly with
  `ObjectStoreObjectNotFoundError`; no fallback behavior is applied.

## Testing

Integration coverage for this package runs against a real SeaweedFS container
through `@mistle/test-harness`.

Commands:

- `pnpm --filter @mistle/object-store test`
- `pnpm --filter @mistle/object-store test:integration`
- `pnpm --filter @mistle/object-store lint`
- `pnpm --filter @mistle/object-store typecheck`
