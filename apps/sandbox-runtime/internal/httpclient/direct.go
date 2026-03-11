package httpclient

import "net/http"

// NewDirectClient clones the provided client and disables proxy resolution on the
// underlying transport so runtime-owned HTTP calls do not loop back through the
// sandbox outbound proxy.
func NewDirectClient(baseClient *http.Client) *http.Client {
	if baseClient == nil {
		baseClient = http.DefaultClient
	}

	clonedClient := *baseClient
	baseTransport := clonedClient.Transport
	if baseTransport == nil {
		baseTransport = http.DefaultTransport
	}

	transport, ok := baseTransport.(*http.Transport)
	if !ok {
		clonedClient.Transport = baseTransport
		return &clonedClient
	}

	clonedTransport := transport.Clone()
	clonedTransport.Proxy = nil
	clonedClient.Transport = clonedTransport
	return &clonedClient
}
