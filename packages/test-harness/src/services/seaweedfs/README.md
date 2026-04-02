# SeaweedFS S3 Service

Starts and manages a SeaweedFS container that exposes an S3-compatible endpoint
for tests.

Use this service when integration or system tests need a real object storage
backend without depending on external shared infrastructure.

## Exports

From [`index.ts`](./index.ts):

- `startSeaweedfsS3(input?)`
- `SeaweedfsS3Service`
- `StartSeaweedfsS3Input`

## Usage Pattern

```ts
import { startSeaweedfsS3 } from "@mistle/test-harness";

const objectStorage = await startSeaweedfsS3({
  bucketName: "mistle-test",
});

// use objectStorage.endpoint from the host test process
// use objectStorage.containerEndpoint from sibling containers on the same Docker network

await objectStorage.stop();
```

## Input Options

`startSeaweedfsS3(input?)` supports:

- `bucketName`
- `accessKeyId`
- `secretAccessKey`
- `startupTimeoutMs`
- `manageProcessCleanup`
- `containerLabels`
- `network`
- `networkAlias`

## Lifecycle

- Startup waits until the SeaweedFS S3 endpoint accepts bucket creation.
- The requested bucket is provisioned before the service is returned.
- `endpoint` is always host-reachable.
- `containerEndpoint` is set when the service is attached to a Docker network.
- `stop()` is required.
- Calling `stop()` twice throws.
- No fallback behavior is applied for startup or teardown failures.
