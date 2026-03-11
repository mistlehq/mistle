package httpclient

import (
	"net/http"
	"testing"
)

func TestNewDirectClient(t *testing.T) {
	baseTransport := http.DefaultTransport.(*http.Transport).Clone()
	baseTransport.Proxy = http.ProxyFromEnvironment
	baseClient := &http.Client{
		Timeout:   123,
		Transport: baseTransport,
	}

	directClient := NewDirectClient(baseClient)
	if directClient == baseClient {
		t.Fatal("expected direct client to be cloned")
	}
	if directClient.Timeout != baseClient.Timeout {
		t.Fatalf("expected timeout %v, got %v", baseClient.Timeout, directClient.Timeout)
	}

	directTransport, ok := directClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("expected direct transport to be *http.Transport, got %T", directClient.Transport)
	}
	if directTransport == baseTransport {
		t.Fatal("expected direct transport to be cloned")
	}
	if directTransport.Proxy != nil {
		t.Fatal("expected direct transport proxy function to be cleared")
	}
	if baseTransport.Proxy == nil {
		t.Fatal("expected base transport proxy function to remain intact")
	}
}
