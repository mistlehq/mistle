import { ensureE2BTemplateAlias } from "../../packages/sandbox/src/providers/e2b/template-build.js";

type ParsedCliArguments = {
  imageRef: string;
  apiKey: string;
  domain?: string;
};

function parseCliArguments(argv: string[]): ParsedCliArguments {
  let imageRef: string | undefined;
  let apiKey: string | undefined;
  let domain: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--image-ref") {
      imageRef = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--api-key") {
      apiKey = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--domain") {
      domain = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(
      "Usage: tsx ./scripts/e2b/prebuild-template.ts --image-ref <ref> --api-key <key> [--domain <domain>]",
    );
  }

  if (imageRef === undefined || apiKey === undefined) {
    throw new Error(
      "Usage: tsx ./scripts/e2b/prebuild-template.ts --image-ref <ref> --api-key <key> [--domain <domain>]",
    );
  }

  return {
    imageRef,
    apiKey,
    ...(domain === undefined ? {} : { domain }),
  };
}

async function main(): Promise<void> {
  const argumentsList = parseCliArguments(process.argv.slice(2));

  process.stdout.write(`Ensuring E2B template for ${argumentsList.imageRef}.\n`);

  const result = await ensureE2BTemplateAlias({
    baseRef: argumentsList.imageRef,
    connectionOptions: {
      apiKey: argumentsList.apiKey,
      ...(argumentsList.domain === undefined ? {} : { domain: argumentsList.domain }),
    },
  });

  if (result.templateExists) {
    process.stdout.write(`Template ${result.alias} already exists.\n`);
    return;
  }

  process.stdout.write(`Built template ${result.alias} for ${argumentsList.imageRef}.\n`);
}

await main();
