package protocol

import (
	"encoding/json"
	"fmt"
)

type ActivationOperationKind string

const (
	ActivationOperationStart      ActivationOperationKind = "start"
	ActivationOperationResume     ActivationOperationKind = "resume"
	ActivationOperationSetupCheck ActivationOperationKind = "setup_check"
	ActivationOperationSnapshot   ActivationOperationKind = "snapshot"
)

type ActivationInput struct {
	OperationKind       ActivationOperationKind        `json:"operationKind"`
	BootstrapToken      string                         `json:"bootstrapToken"`
	TunnelExchangeToken string                         `json:"tunnelExchangeToken"`
	TunnelGatewayWSURL  string                         `json:"tunnelGatewayWsUrl"`
	RuntimePlan         json.RawMessage                `json:"runtimePlan"`
	ActingUserID        *string                        `json:"actingUserId"`
	GitIdentity         *GitIdentity                   `json:"gitIdentity"`
	TransparentProxy    *TransparentProxyConfiguration `json:"transparentProxy,omitempty"`
}

func DecodeActivationInput(data []byte) (ActivationInput, error) {
	var input ActivationInput
	if err := decodeStrict(data, &input); err != nil {
		return ActivationInput{}, err
	}
	switch input.OperationKind {
	case ActivationOperationStart, ActivationOperationResume, ActivationOperationSetupCheck, ActivationOperationSnapshot:
	default:
		return ActivationInput{}, fmt.Errorf("unsupported activation operation kind: %s", input.OperationKind)
	}
	return input, nil
}

type GitSigningConfig struct {
	Format                  string  `json:"format"`
	Program                 string  `json:"program"`
	KeyRef                  string  `json:"keyRef"`
	OrganizationID          string  `json:"organizationId"`
	ProviderFamily          string  `json:"providerFamily"`
	IntegrationConnectionID *string `json:"integrationConnectionId"`
	ActingUserID            string  `json:"actingUserId"`
	Grant                   string  `json:"grant"`
}

type GitIdentity struct {
	Name    string            `json:"name"`
	Email   string            `json:"email"`
	Signing *GitSigningConfig `json:"signing"`
}

type TransparentProxyBypassKind string

const TransparentProxyBypassSocketMark TransparentProxyBypassKind = "socket_mark"

type TransparentProxyBypass struct {
	Kind TransparentProxyBypassKind `json:"kind"`
	Mark uint32                     `json:"mark"`
}

type TransparentProxyExclusionKind string

const (
	TransparentProxyExclusionCIDR TransparentProxyExclusionKind = "cidr"
	TransparentProxyExclusionHost TransparentProxyExclusionKind = "host"
)

type TransparentProxyExclusion struct {
	Kind   TransparentProxyExclusionKind `json:"kind"`
	Value  string                        `json:"value"`
	Reason string                        `json:"reason"`
}

type TransparentProxyConfiguration struct {
	PassthroughBypass TransparentProxyBypass      `json:"passthroughBypass"`
	Exclusions        []TransparentProxyExclusion `json:"exclusions"`
}

type ActivationResponse struct {
	OK    bool
	Error string
}

func DecodeActivationResponse(data []byte) (ActivationResponse, error) {
	var raw struct {
		OK    bool    `json:"ok"`
		Error *string `json:"error"`
	}
	if err := decodeStrict(data, &raw); err != nil {
		return ActivationResponse{}, err
	}
	if raw.OK {
		if raw.Error != nil {
			return ActivationResponse{}, fmt.Errorf("activation success response must not contain error")
		}
		return ActivationResponse{OK: true}, nil
	}
	if raw.Error == nil {
		return ActivationResponse{}, fmt.Errorf("activation error response must contain an error")
	}
	if *raw.Error == "" {
		return ActivationResponse{}, fmt.Errorf("activation error response must contain a non-empty error")
	}
	return ActivationResponse{OK: false, Error: *raw.Error}, nil
}
