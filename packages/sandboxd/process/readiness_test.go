package process

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
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

func TestCheckTCPReadinessConnectsToListeningSocket(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	defer listener.Close()
	accepted := make(chan struct{})
	go func() {
		connection, err := listener.Accept()
		if err == nil {
			connection.Close()
		}
		close(accepted)
	}()

	host, port := splitListenerHostPort(t, listener)
	requireNoError(t, CheckTCPReadiness(host, port))
	<-accepted
}

func TestCheckHTTPReadinessRequiresExpectedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, "/readyz")
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	requireNoError(t, CheckHTTPReadiness(server.URL+"/readyz", http.StatusNoContent))

	err := CheckHTTPReadiness(server.URL+"/readyz", http.StatusOK)
	if err == nil {
		t.Fatalf("expected status mismatch to fail")
	}
	if !strings.Contains(err.Error(), "expected 200") {
		t.Fatalf("expected status mismatch error, got %v", err)
	}
}

func TestCheckWSReadinessAcceptsUpgradeResponse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	defer listener.Close()
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		defer connection.Close()
		reader := bufio.NewReader(connection)
		for {
			line, err := reader.ReadString('\n')
			if err != nil || line == "\r\n" {
				break
			}
		}
		_, _ = connection.Write([]byte("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"))
	}()

	host, port := splitListenerHostPort(t, listener)
	requireNoError(t, CheckWSReadiness("ws://"+net.JoinHostPort(host, formatPort(port))+"/agent"))
}

func TestReadinessProbeRequestRejectsUnsupportedTLSReadinessScheme(t *testing.T) {
	_, err := ReadinessProbeRequest("https://127.0.0.1:443/readyz", nil, DefaultProcessReadinessProbeTimeout)
	if err == nil {
		t.Fatalf("expected https readiness probe to fail")
	}
	assertEqual(t, err.Error(), "readiness url scheme \"https\" is not supported yet")
}

func TestCheckRuntimeClientProcessReadinessFromSpecUsesHTTPExpectedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	processSpec := RuntimeClientProcessSpec{
		ProcessKey: "http-server",
		Readiness: runtime.RuntimeClientProcessReadiness{
			Type:           runtime.RuntimeClientProcessReadinessHTTP,
			URL:            server.URL,
			ExpectedStatus: http.StatusAccepted,
			TimeoutMS:      1_000,
		},
	}

	requireNoError(t, CheckRuntimeClientProcessReadinessFromSpec(processSpec))
}

func splitListenerHostPort(t *testing.T, listener net.Listener) (string, uint16) {
	t.Helper()
	host, portText, err := net.SplitHostPort(listener.Addr().String())
	requireNoError(t, err)
	port, err := net.LookupPort("tcp", portText)
	requireNoError(t, err)
	return host, uint16(port)
}

func formatPort(port uint16) string {
	return strconv.FormatUint(uint64(port), 10)
}
