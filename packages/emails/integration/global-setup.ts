import {
  acquireSharedMailpitInfra,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
  removeTestContext,
  writeTestContext,
} from "@mistle/test-harness";

const SHARED_INFRA_KEY = DEFAULT_SHARED_INTEGRATION_INFRA_KEY;
const TestContextId = "emails.integration";

export default async function setup(): Promise<() => Promise<void>> {
  const sharedInfraLease = await acquireSharedMailpitInfra({
    key: SHARED_INFRA_KEY,
  });

  try {
    await writeTestContext({
      id: TestContextId,
      value: {
        smtpHost: sharedInfraLease.infra.mailpit.smtpHost,
        smtpPort: sharedInfraLease.infra.mailpit.smtpPort,
        httpBaseUrl: sharedInfraLease.infra.mailpit.httpBaseUrl,
      },
    });
  } catch (error) {
    await removeTestContext(TestContextId);
    await sharedInfraLease.release();
    throw error;
  }

  return async () => {
    await removeTestContext(TestContextId);
    await sharedInfraLease.release();
  };
}
