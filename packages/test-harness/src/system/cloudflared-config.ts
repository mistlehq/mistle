type BuildCloudflaredTunnelConfigInput = {
  tunnelId: string;
  credentialsFilePath: string;
  ingressRules: ReadonlyArray<{
    publicHostname: string;
    serviceUrl: string;
  }>;
};

type CloudflaredTunnelCredentials = {
  AccountTag: string;
  TunnelSecret: string;
  TunnelID: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function parseCloudflaredTunnelCredentialsJson(input: {
  tunnelId: string;
  credentialsJson: string;
}): CloudflaredTunnelCredentials {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(input.credentialsJson);
  } catch (error) {
    throw new Error("Cloudflare tunnel credentials JSON must contain valid JSON.", {
      cause: error,
    });
  }

  if (
    typeof parsedValue !== "object" ||
    parsedValue === null ||
    !isNonEmptyString(Reflect.get(parsedValue, "AccountTag")) ||
    !isNonEmptyString(Reflect.get(parsedValue, "TunnelSecret")) ||
    !isNonEmptyString(Reflect.get(parsedValue, "TunnelID"))
  ) {
    throw new Error(
      "Cloudflare tunnel credentials JSON must include non-empty AccountTag, TunnelSecret, and TunnelID fields.",
    );
  }

  const credentials = parsedValue as CloudflaredTunnelCredentials;
  if (credentials.TunnelID !== input.tunnelId) {
    throw new Error(
      `Cloudflare tunnel credentials TunnelID '${credentials.TunnelID}' does not match configured tunnel id '${input.tunnelId}'.`,
    );
  }

  return credentials;
}

export function buildCloudflaredTunnelConfig(input: BuildCloudflaredTunnelConfigInput): string {
  if (input.ingressRules.length === 0) {
    throw new Error("Cloudflare tunnel config requires at least one ingress rule.");
  }

  return [
    `tunnel: ${input.tunnelId}`,
    `credentials-file: ${input.credentialsFilePath}`,
    "protocol: http2",
    "ingress:",
    ...input.ingressRules.flatMap((rule) => [
      `  - hostname: ${rule.publicHostname}`,
      `    service: ${rule.serviceUrl}`,
    ]),
    "  - service: http_status:404",
    "",
  ].join("\n");
}
