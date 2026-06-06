package protocol

import "encoding/json"

type SessionRuntimeInput struct {
	OperationKind       ActivationOperationKind
	BootstrapToken      string
	TunnelExchangeToken string
	TunnelGatewayWSURL  string
	RuntimePlan         json.RawMessage
	ActingUserID        *string
	GitIdentity         *GitIdentity
	TransparentProxy    *TransparentProxyConfiguration
}

func SessionRuntimeInputFromActivationInput(input ActivationInput) SessionRuntimeInput {
	return SessionRuntimeInput{
		OperationKind:       input.OperationKind,
		BootstrapToken:      input.BootstrapToken,
		TunnelExchangeToken: input.TunnelExchangeToken,
		TunnelGatewayWSURL:  input.TunnelGatewayWSURL,
		RuntimePlan:         append(json.RawMessage(nil), input.RuntimePlan...),
		ActingUserID:        input.ActingUserID,
		GitIdentity:         input.GitIdentity,
		TransparentProxy:    input.TransparentProxy,
	}
}
