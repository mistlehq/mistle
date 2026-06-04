import { composeIntegrationMiddleware } from "../middleware/index.js";
import type { IntegrationMiddlewareNext } from "../middleware/index.js";
import type {
  IntegrationWebhookImmediateResponse,
  IntegrationWebhookMiddleware,
  IntegrationWebhookMiddlewareBaseContext,
  IntegrationWebhookMiddlewareContext,
  IntegrationWebhookRequestSnapshot,
  IntegrationWebhookHeaders,
} from "../types/index.js";

export type CreateIntegrationWebhookRequestSnapshotInput = {
  targetKey: string;
  endpointKey: string;
  headers: IntegrationWebhookHeaders;
  rawBody: Uint8Array;
};

export function createIntegrationWebhookRequestSnapshot(
  input: CreateIntegrationWebhookRequestSnapshotInput,
): IntegrationWebhookRequestSnapshot {
  let decodedText: string | undefined;
  let parsedJson: unknown;
  let jsonParsed = false;

  return {
    targetKey: input.targetKey,
    endpointKey: input.endpointKey,
    headers: input.headers,
    rawBody: input.rawBody,
    text: () => {
      if (decodedText === undefined) {
        decodedText = new TextDecoder().decode(input.rawBody);
      }

      return decodedText;
    },
    json: () => {
      if (!jsonParsed) {
        decodedText ??= new TextDecoder().decode(input.rawBody);
        parsedJson = JSON.parse(decodedText);
        jsonParsed = true;
      }

      return parsedJson;
    },
  };
}

export type RunIntegrationWebhookMiddlewareResult<TResult> =
  | {
      kind: "continued";
      result: TResult;
    }
  | {
      kind: "short-circuited";
      response: IntegrationWebhookImmediateResponse;
    };

export async function runIntegrationWebhookMiddleware<TResult>(input: {
  middleware: readonly IntegrationWebhookMiddleware[];
  context: IntegrationWebhookMiddlewareBaseContext;
  next(context: IntegrationWebhookMiddlewareContext): Promise<TResult>;
}): Promise<RunIntegrationWebhookMiddlewareResult<TResult>> {
  let selectedResponse: IntegrationWebhookImmediateResponse | undefined;
  let continued = false;
  let terminalPromise: Promise<TResult> | undefined;

  const next: IntegrationMiddlewareNext = () => {
    if (selectedResponse !== undefined) {
      throw new Error("Integration webhook middleware cannot continue after responding.");
    }

    continued = true;
    terminalPromise = input.next(context);
    return terminalPromise.then(() => {});
  };

  const context: IntegrationWebhookMiddlewareContext = {
    ...input.context,
    respond(response) {
      if (continued) {
        throw new Error("Integration webhook middleware cannot respond after continuing.");
      }

      if (selectedResponse !== undefined) {
        throw new Error("Integration webhook middleware response has already been set.");
      }

      selectedResponse = response;
    },
  };

  await composeIntegrationMiddleware(input.middleware)(context, next);

  if (!continued) {
    if (selectedResponse === undefined) {
      throw new Error("Integration webhook middleware short-circuited without setting a response.");
    }

    return {
      kind: "short-circuited",
      response: selectedResponse,
    };
  }

  if (terminalPromise === undefined) {
    throw new Error("Integration webhook middleware terminal handler did not run.");
  }

  const result = await terminalPromise;
  return {
    kind: "continued",
    result,
  };
}
