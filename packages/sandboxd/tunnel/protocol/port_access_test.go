package protocol

import "testing"

func TestPortsTargetAuthorizeResultsMatchTunnelContract(t *testing.T) {
	success, err := PortsTargetAuthorizeSuccessResult("ports_req_1", "http", true)
	requireNoError(t, err)
	assertEqual(t, success, `{"authorized":true,"requestId":"ports_req_1","type":"ports.target.authorize.result","upstreamProtocol":"http","websocketCapable":true}`)

	failure, err := PortsTargetAuthorizeFailureResult("ports_req_2", PortAccessAuthorizeReasonPortUnreachable)
	requireNoError(t, err)
	assertEqual(t, failure, `{"authorized":false,"reason":"port_unreachable","requestId":"ports_req_2","type":"ports.target.authorize.result"}`)
}

func TestParsePortsControlMessages(t *testing.T) {
	message, err := ParsePortsControlMessage(`{"type":"ports.target.authorize","requestId":"ports_req_1","target":{"kind":"port","port":3000}}`)
	requireNoError(t, err)
	assertEqual(t, message.TargetAuthorize.RequestID, "ports_req_1")
	assertEqual(t, message.TargetAuthorize.Target.Kind, "port")
	assertEqual(t, message.TargetAuthorize.Target.Port, uint16(3000))

	ignored, err := ParsePortsControlMessage(`{"type":"stream.open","streamId":1,"channel":{"kind":"agent"}}`)
	requireNoError(t, err)
	if ignored != nil {
		t.Fatalf("expected non-ports control message to be ignored")
	}
}

func TestParsePortsControlMessageRejectsInvalidPayloads(t *testing.T) {
	tests := []struct {
		name    string
		payload string
	}{
		{name: "empty request id", payload: `{"type":"ports.target.authorize","requestId":"","target":{"kind":"port","port":3000}}`},
		{name: "wrong target kind", payload: `{"type":"ports.target.authorize","requestId":"ports_req_1","target":{"kind":"service","port":3000}}`},
		{name: "zero port", payload: `{"type":"ports.target.authorize","requestId":"ports_req_1","target":{"kind":"port","port":0}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParsePortsControlMessage(test.payload)
			if err == nil {
				t.Fatalf("expected invalid payload to fail")
			}
		})
	}
}

func TestParsePortsTransportMessagesMatchTunnelContract(t *testing.T) {
	tcpOpen, err := ParsePortsTransportMessage(`{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":5173},"upstreamProtocol":"https"}`)
	requireNoError(t, err)
	if tcpOpen.TCPOpen == nil {
		t.Fatalf("expected ports.tcp.open")
	}

	tcpConnected, err := ParsePortsTransportMessage(`{"type":"ports.tcp.connected","streamId":61}`)
	requireNoError(t, err)
	if tcpConnected.TCPConnected == nil {
		t.Fatalf("expected ports.tcp.connected")
	}

	tcpClose, err := ParsePortsTransportMessage(`{"type":"ports.tcp.close","streamId":61,"direction":"request"}`)
	requireNoError(t, err)
	if tcpClose.TCPClose == nil {
		t.Fatalf("expected ports.tcp.close")
	}

	tcpError, err := ParsePortsTransportMessage(`{"type":"ports.tcp.error","streamId":61,"code":"upstream_connect_failed","message":"target refused connection"}`)
	requireNoError(t, err)
	if tcpError.TCPError == nil {
		t.Fatalf("expected ports.tcp.error")
	}

	httpOpen, err := ParsePortsTransportMessage(`{"type":"ports.http.open","streamId":41,"target":{"kind":"port","port":5173},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"import=1","headers":{"accept":["text/plain"]}}}`)
	requireNoError(t, err)
	if httpOpen.HTTPOpen == nil {
		t.Fatalf("expected ports.http.open")
	}

	responseStart, err := ParsePortsTransportMessage(`{"type":"ports.http.response.start","streamId":41,"status":200,"headers":{"content-type":["text/plain"]}}`)
	requireNoError(t, err)
	if responseStart.HTTPResponseStart == nil {
		t.Fatalf("expected ports.http.response.start")
	}
	assertEqual(t, responseStart.HTTPResponseStart.Status, 200)

	bodyChunk, err := ParsePortsTransportMessage(`{"type":"ports.http.body.chunk","streamId":41,"direction":"response","bytes":"SGVsbG8=","encoding":"base64"}`)
	requireNoError(t, err)
	if bodyChunk.HTTPBodyChunk == nil {
		t.Fatalf("expected ports.http.body.chunk")
	}

	bodyEnd, err := ParsePortsTransportMessage(`{"type":"ports.http.body.end","streamId":41,"direction":"response"}`)
	requireNoError(t, err)
	if bodyEnd.HTTPBodyEnd == nil {
		t.Fatalf("expected ports.http.body.end")
	}

	streamClose, err := ParsePortsTransportMessage(`{"type":"ports.stream.close","streamId":41}`)
	requireNoError(t, err)
	if streamClose.StreamClose == nil {
		t.Fatalf("expected ports.stream.close")
	}

	streamError, err := ParsePortsTransportMessage(`{"type":"ports.stream.error","streamId":41,"code":"upstream_io_error","message":"upstream closed early"}`)
	requireNoError(t, err)
	if streamError.StreamError == nil {
		t.Fatalf("expected ports.stream.error")
	}
}

func TestParsePortsTransportMessagesIgnoreUnknownFields(t *testing.T) {
	message, err := ParsePortsTransportMessage(`{"type":"ports.http.open","streamId":41,"ignored":true,"target":{"kind":"port","port":5173,"ignored":true},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"import=1","headers":{"accept":["text/plain"]},"ignored":true}}`)
	requireNoError(t, err)
	if message.HTTPOpen == nil {
		t.Fatalf("expected ports.http.open")
	}
	assertEqual(t, message.HTTPOpen.StreamID, uint32(41))
	assertEqual(t, message.HTTPOpen.Request.Path, "/src/main.ts")
}

func TestParsePortsTransportMessageRejectsInvalidPayloads(t *testing.T) {
	tests := []struct {
		name     string
		payload  string
		expected string
	}{
		{
			name:     "unsupported tcp upstream protocol",
			payload:  `{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":5173},"upstreamProtocol":"ftp"}`,
			expected: `ports.tcp.open upstreamProtocol must be 'http' or 'https', got "ftp"`,
		},
		{
			name:     "invalid tcp target kind",
			payload:  `{"type":"ports.tcp.open","streamId":61,"target":{"kind":"host","port":5173},"upstreamProtocol":"http"}`,
			expected: `ports target kind must be 'port', got "host"`,
		},
		{
			name:     "invalid tcp target port",
			payload:  `{"type":"ports.tcp.open","streamId":61,"target":{"kind":"port","port":0},"upstreamProtocol":"http"}`,
			expected: "ports target port must be greater than zero",
		},
		{
			name:     "invalid tcp close direction",
			payload:  `{"type":"ports.tcp.close","streamId":61,"direction":"both"}`,
			expected: `ports.tcp.close direction must be 'request' or 'response', got "both"`,
		},
		{
			name:     "invalid http response status",
			payload:  `{"type":"ports.http.response.start","streamId":41,"status":101,"headers":{"content-type":["text/plain"]}}`,
			expected: "ports.http.response.start status must be between 200 and 599",
		},
		{
			name:     "invalid high http response status",
			payload:  `{"type":"ports.http.response.start","streamId":41,"status":700,"headers":{"content-type":["text/plain"]}}`,
			expected: "ports.http.response.start status must be between 200 and 599",
		},
		{
			name:     "empty http open query",
			payload:  `{"type":"ports.http.open","streamId":41,"target":{"kind":"port","port":5173},"upstreamProtocol":"https","request":{"method":"GET","path":"/src/main.ts","query":"","headers":{"accept":["text/plain"]}}}`,
			expected: "ports.http.open request.query must be non-empty when provided",
		},
		{
			name:     "invalid tcp error code",
			payload:  `{"type":"ports.tcp.error","streamId":61,"code":"future_code","message":"target refused connection"}`,
			expected: `ports.tcp.error code is not supported: "future_code"`,
		},
		{
			name:     "empty tcp error message",
			payload:  `{"type":"ports.tcp.error","streamId":61,"code":"upstream_connect_failed","message":""}`,
			expected: "ports.tcp.error message is required",
		},
		{
			name:     "invalid stream error code",
			payload:  `{"type":"ports.stream.error","streamId":41,"code":"future_code","message":"upstream closed early"}`,
			expected: `ports.stream.error code is not supported: "future_code"`,
		},
		{
			name:     "empty stream error message",
			payload:  `{"type":"ports.stream.error","streamId":41,"code":"upstream_io_error","message":""}`,
			expected: "ports.stream.error message is required",
		},
		{
			name:     "invalid http response header",
			payload:  `{"type":"ports.http.response.start","streamId":41,"status":200,"headers":{"":["text/plain"]}}`,
			expected: "ports.http.response.start headers header names must be non-empty",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParsePortsTransportMessage(test.payload)
			if err == nil {
				t.Fatalf("expected invalid payload to fail")
			}
			assertEqual(t, err.Error(), test.expected)
		})
	}
}
