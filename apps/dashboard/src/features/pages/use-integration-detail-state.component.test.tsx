// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useIntegrationDetailState } from "./use-integration-detail-state.js";

describe("useIntegrationDetailState", () => {
  it("keeps non-active connections in the detail state", () => {
    const { result } = renderHook(() =>
      useIntegrationDetailState({
        cards: [
          createCard({
            targetKey: "github",
            connections: [createConnection({ id: "icn_error", status: "error" })],
          }),
        ],
        detailConnectionId: null,
        detailTargetKey: "github",
      }),
    );

    expect(result.current.selectedDetailCard?.target.targetKey).toBe("github");
    expect(result.current.selectedDetailConnections).toHaveLength(1);
    expect(result.current.selectedDetailConnections[0]?.status).toBe("error");
    expect(result.current.activeDetailConnectionId).toBe("icn_error");
  });

  it("prefers an active connection as the default selection when available", () => {
    const { result } = renderHook(() =>
      useIntegrationDetailState({
        cards: [
          createCard({
            targetKey: "github",
            connections: [
              createConnection({ id: "icn_error", status: "error" }),
              createConnection({ id: "icn_active", status: "active" }),
            ],
          }),
        ],
        detailConnectionId: null,
        detailTargetKey: "github",
      }),
    );

    expect(result.current.activeDetailConnectionId).toBe("icn_active");
  });

  it("honors a route-selected connection when it exists", () => {
    const { result } = renderHook(() =>
      useIntegrationDetailState({
        cards: [
          createCard({
            targetKey: "github",
            connections: [
              createConnection({ id: "icn_error", status: "error" }),
              createConnection({ id: "icn_active", status: "active" }),
            ],
          }),
        ],
        detailConnectionId: "icn_error",
        detailTargetKey: "github",
      }),
    );

    expect(result.current.activeDetailConnectionId).toBe("icn_error");
  });

  it("falls back to the default connection when the selected connection disappears", () => {
    const cards = [
      createCard({
        targetKey: "github",
        connections: [
          createConnection({ id: "icn_error", status: "error" }),
          createConnection({ id: "icn_active", status: "active" }),
        ],
      }),
    ];
    const { result, rerender } = renderHook(
      ({ nextCards }) =>
        useIntegrationDetailState({
          cards: nextCards,
          detailConnectionId: null,
          detailTargetKey: "github",
        }),
      {
        initialProps: {
          nextCards: cards,
        },
      },
    );

    act(() => {
      result.current.setActiveDetailConnectionId("icn_error");
    });
    expect(result.current.activeDetailConnectionId).toBe("icn_error");

    rerender({
      nextCards: [
        createCard({
          targetKey: "github",
          connections: [createConnection({ id: "icn_active", status: "active" })],
        }),
      ],
    });

    expect(result.current.activeDetailConnectionId).toBe("icn_active");
  });

  it("does not restore a stale requested connection when it reappears later", () => {
    const { result, rerender } = renderHook(
      ({ nextCards }) =>
        useIntegrationDetailState({
          cards: nextCards,
          detailConnectionId: null,
          detailTargetKey: "github",
        }),
      {
        initialProps: {
          nextCards: [
            createCard({
              targetKey: "github",
              connections: [
                createConnection({ id: "icn_error", status: "error" }),
                createConnection({ id: "icn_active", status: "active" }),
              ],
            }),
          ],
        },
      },
    );

    act(() => {
      result.current.setActiveDetailConnectionId("icn_error");
    });
    expect(result.current.activeDetailConnectionId).toBe("icn_error");

    rerender({
      nextCards: [
        createCard({
          targetKey: "github",
          connections: [createConnection({ id: "icn_active", status: "active" })],
        }),
      ],
    });
    expect(result.current.activeDetailConnectionId).toBe("icn_active");

    rerender({
      nextCards: [
        createCard({
          targetKey: "github",
          connections: [
            createConnection({ id: "icn_error", status: "error" }),
            createConnection({ id: "icn_active", status: "active" }),
          ],
        }),
      ],
    });
    expect(result.current.activeDetailConnectionId).toBe("icn_active");
  });

  it("selects a route-requested connection when it appears after a stale directory refresh", () => {
    const { result, rerender } = renderHook(
      ({ nextCards }) =>
        useIntegrationDetailState({
          cards: nextCards,
          detailConnectionId: "icn_route_selected",
          detailTargetKey: "github",
        }),
      {
        initialProps: {
          nextCards: [
            createCard({
              targetKey: "github",
              connections: [createConnection({ id: "icn_active", status: "active" })],
            }),
          ],
        },
      },
    );

    expect(result.current.activeDetailConnectionId).toBe("icn_active");

    rerender({
      nextCards: [
        createCard({
          targetKey: "github",
          connections: [
            createConnection({ id: "icn_active", status: "active" }),
            createConnection({ id: "icn_route_selected", status: "active" }),
          ],
        }),
      ],
    });

    expect(result.current.activeDetailConnectionId).toBe("icn_route_selected");
  });
});

function createConnection(input: {
  id: string;
  status: IntegrationConnection["status"];
}): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "github",
    displayName: input.id,
    status: input.status,
    bindingCount: 0,
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
  };
}

function createCard(input: {
  targetKey: string;
  connections: readonly IntegrationConnection[];
}): IntegrationCardViewModel {
  return {
    target: {
      targetKey: input.targetKey,
      familyId: "github",
      variantId: "github-cloud",
      kind: "git",
      enabled: true,
      config: {},
      displayName: "GitHub",
      description: "GitHub",
      connectionMethods: [
        {
          id: "github-app-installation",
          label: "GitHub App installation",
          kind: "form",
          secretFields: [
            {
              name: "appPrivateKeyPem",
              label: "App private key PEM",
              inputType: "textarea",
            },
            {
              name: "webhookSecret",
              label: "Webhook secret",
              inputType: "password",
            },
          ],
        },
      ],
      targetHealth: {
        configStatus: "valid",
      },
    },
    displayName: "GitHub",
    description: "GitHub",
    status: "Error",
    configStatus: "valid",
    connections: input.connections,
  };
}
