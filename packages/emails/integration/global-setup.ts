import {
  acquireSharedMailpitInfra,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
} from "@mistle/test-harness";

const SHARED_INFRA_KEY = DEFAULT_SHARED_INTEGRATION_INFRA_KEY;

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

export default async function setup(): Promise<() => Promise<void>> {
  const sharedInfraLease = await acquireSharedMailpitInfra({
    key: SHARED_INFRA_KEY,
  });

  try {
    setEnv("MISTLE_EMAILS_IT_MAILPIT_SMTP_HOST", sharedInfraLease.infra.mailpit.smtpHost);
    setEnv("MISTLE_EMAILS_IT_MAILPIT_SMTP_PORT", String(sharedInfraLease.infra.mailpit.smtpPort));
    setEnv("MISTLE_EMAILS_IT_MAILPIT_HTTP_BASE_URL", sharedInfraLease.infra.mailpit.httpBaseUrl);
  } catch (error) {
    await sharedInfraLease.release();
    throw error;
  }

  return async () => {
    await sharedInfraLease.release();
  };
}
