import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { z } from "zod";

import {
  IntegrationConnectionsBadRequestError,
  type IntegrationConnectionsBadRequestCode,
} from "./errors.js";

const registry = createIntegrationRegistry();

export function resolveConnectionUserSecretsOrThrow(input: {
  familyId: string;
  variantId: string;
  targetKey: string;
  rawSecrets: Record<string, string>;
  invalidInputCode: IntegrationConnectionsBadRequestCode;
}): Record<string, string> {
  const definition = registry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });

  if (definition === undefined) {
    throw new IntegrationConnectionsBadRequestError(
      input.invalidInputCode,
      `Integration definition '${input.familyId}/${input.variantId}' is not registered.`,
    );
  }

  const userSecretSlots = definition.userSecretSlots ?? [];
  const userSecretSlotsByKey = new Map(userSecretSlots.map((slot) => [slot.key, slot]));

  for (const userSecretSlot of userSecretSlots) {
    if (userSecretSlot.required !== true) {
      continue;
    }

    const rawSecretValue = input.rawSecrets[userSecretSlot.key];
    if (rawSecretValue === undefined) {
      throw new IntegrationConnectionsBadRequestError(
        input.invalidInputCode,
        `Connection secrets for '${input.targetKey}' are missing required key '${userSecretSlot.key}'.`,
      );
    }
  }

  const parsedSecrets: Record<string, string> = {};

  for (const [rawSecretKey, rawSecretValue] of Object.entries(input.rawSecrets)) {
    const userSecretSlot = userSecretSlotsByKey.get(rawSecretKey);
    if (userSecretSlot === undefined) {
      throw new IntegrationConnectionsBadRequestError(
        input.invalidInputCode,
        `Connection secrets for '${input.targetKey}' include unsupported key '${rawSecretKey}'.`,
      );
    }

    try {
      parsedSecrets[rawSecretKey] = userSecretSlot.valueSchema.parse(rawSecretValue);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new IntegrationConnectionsBadRequestError(
          input.invalidInputCode,
          `Connection secret '${rawSecretKey}' for '${input.targetKey}' is invalid.`,
        );
      }

      throw error;
    }
  }

  return parsedSecrets;
}
