package process

import (
	"testing"

	"github.com/mistle/sandboxd/runtime"
)

func TestParsesReadinessURLWithDefaultPortAndRootPath(t *testing.T) {
	parsedURL, err := ParseReadinessURL("ws://127.0.0.1")
	requireNoError(t, err)

	assertEqual(t, parsedURL.Scheme, "ws")
	assertEqual(t, parsedURL.Host, "127.0.0.1")
	assertEqual(t, parsedURL.Port, uint16(80))
	assertEqual(t, parsedURL.Path, "/")
}

func TestParsesReadinessURLWithExplicitPortAndPath(t *testing.T) {
	parsedURL, err := ParseReadinessURL("http://localhost:4200/readyz")
	requireNoError(t, err)

	assertEqual(t, parsedURL.Scheme, "http")
	assertEqual(t, parsedURL.Host, "localhost")
	assertEqual(t, parsedURL.Port, uint16(4200))
	assertEqual(t, parsedURL.Path, "/readyz")
}

func TestDerivesCodexAppServerReadyzURLFromWSReadinessURL(t *testing.T) {
	readyzURL, err := CodexAppServerReadyzURL("ws://127.0.0.1:3900/agent")
	requireNoError(t, err)

	assertEqual(t, readyzURL, "http://127.0.0.1:3900/readyz")
}

func TestRejectsReadinessURLWithoutHost(t *testing.T) {
	_, err := ParseReadinessURL("http:///readyz")
	if err == nil {
		t.Fatalf("expected missing host to fail")
	}
	assertEqual(t, err.Error(), "readiness url \"http:///readyz\" is missing a host")
}

func TestParsesHTTPStatusFromResponseStatusLine(t *testing.T) {
	status, err := ParseHTTPStatus("HTTP/1.1 204 No Content\r\nConnection: close\r\n")
	requireNoError(t, err)

	assertEqual(t, status, uint16(204))
}

func TestRejectsIncompleteHTTPStatusLine(t *testing.T) {
	_, err := ParseHTTPStatus("HTTP/1.1\r\n")
	if err == nil {
		t.Fatalf("expected incomplete status line to fail")
	}
	assertEqual(t, err.Error(), "readiness response status line was incomplete")
}

func TestReadinessTypeTargetAndTimeout(t *testing.T) {
	tcpSpec := RuntimeClientProcessSpec{
		ProcessKey: "worker",
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type:      runtime.RuntimeClientProcessReadinessTCP,
			Host:      "127.0.0.1",
			Port:      4500,
			TimeoutMS: 1000,
		},
	}
	httpSpec := RuntimeClientProcessSpec{
		ProcessKey: "server",
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type:      runtime.RuntimeClientProcessReadinessHTTP,
			URL:       "http://127.0.0.1:4500/ready",
			TimeoutMS: 2000,
		},
	}
	noneSpec := RuntimeClientProcessSpec{
		ProcessKey: "setup",
		Readiness:  runtime.RuntimeClientProcessReadiness{Type: runtime.RuntimeClientProcessReadinessNone},
	}

	assertEqual(t, ReadinessType(tcpSpec), "tcp")
	assertEqual(t, ReadinessTarget(tcpSpec), "127.0.0.1:4500")
	assertEqual(t, ReadinessTimeoutMS(tcpSpec), uint64(1000))
	assertEqual(t, ReadinessTarget(httpSpec), "http://127.0.0.1:4500/ready")
	assertEqual(t, ReadinessTimeoutMS(httpSpec), uint64(2000))
	assertEqual(t, ReadinessTarget(noneSpec), "")
	assertEqual(t, ReadinessTimeoutMS(noneSpec), uint64(0))
}
