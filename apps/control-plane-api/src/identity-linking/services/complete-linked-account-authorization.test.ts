import { BadRequestError } from "@mistle/http/errors.js";
import { describe, expect, it } from "vitest";

import { IdentityLinkingBadRequestCodes } from "../constants.js";
import { normalizeCompletedLinkedAccountAuthorizationOrThrow } from "./complete-linked-account-authorization.js";

function getBadRequestCodeOrThrow(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BadRequestError) {
      return error.code;
    }

    throw error;
  }

  throw new Error("Expected normalizeCompletedLinkedAccountAuthorizationOrThrow to throw.");
}

describe("normalizeCompletedLinkedAccountAuthorizationOrThrow", () => {
  it("trims and returns required provider identity material", () => {
    expect(
      normalizeCompletedLinkedAccountAuthorizationOrThrow({
        providerSubjectId: " 12345 ",
        profile: {
          login: "mistle-user",
        },
        keys: [
          {
            keyType: " account_id ",
            keyValue: " 12345 ",
          },
        ],
        credential: {
          credentialKind: " github_app_user_access_token ",
          secrets: [
            {
              secretKind: " oauth2_access_token ",
              plaintext: " user-token ",
            },
          ],
        },
      }),
    ).toEqual({
      providerSubjectId: "12345",
      profile: {
        login: "mistle-user",
      },
      keys: [
        {
          keyType: "account_id",
          keyValue: "12345",
        },
      ],
      credential: {
        credentialKind: "github_app_user_access_token",
        secrets: [
          {
            secretKind: "oauth2_access_token",
            plaintext: " user-token ",
          },
        ],
      },
    });
  });

  it("fails when the provider subject id is empty", () => {
    expect(() =>
      normalizeCompletedLinkedAccountAuthorizationOrThrow({
        providerSubjectId: "   ",
        keys: [
          {
            keyType: "account_id",
            keyValue: "12345",
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[BadRequestError: Identity-link callback must return a non-empty provider subject id.]`,
    );

    expect(
      getBadRequestCodeOrThrow(() =>
        normalizeCompletedLinkedAccountAuthorizationOrThrow({
          providerSubjectId: "   ",
          keys: [
            {
              keyType: "account_id",
              keyValue: "12345",
            },
          ],
        }),
      ),
    ).toBe(IdentityLinkingBadRequestCodes.INVALID_LINKED_ACCOUNT_CALLBACK_INPUT);
  });

  it("fails when a provider identity key is empty or duplicated", () => {
    expect(() =>
      normalizeCompletedLinkedAccountAuthorizationOrThrow({
        providerSubjectId: "12345",
        keys: [
          {
            keyType: "account_id",
            keyValue: "   ",
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[BadRequestError: Identity-link callback must return non-empty provider identity keys.]`,
    );

    expect(() =>
      normalizeCompletedLinkedAccountAuthorizationOrThrow({
        providerSubjectId: "12345",
        keys: [
          {
            keyType: "account_id",
            keyValue: "12345",
          },
          {
            keyType: "account_id",
            keyValue: "12345",
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[BadRequestError: Identity-link callback returned duplicate provider identity keys.]`,
    );
  });
});
