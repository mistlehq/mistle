package sessionprotocol

// ProtocolVersion is the currently supported control message protocol version.
const ProtocolVersion = 1

const (
	MessageTypeConnect      = "connect"
	MessageTypeConnectOK    = "connect.ok"
	MessageTypeConnectError = "connect.error"
	MessageTypeDisconnect   = "disconnect"
	MessageTypePTYResize    = "pty.resize"
	MessageTypePTYClose     = "pty.close"
	MessageTypePTYCloseOK   = "pty.close.ok"
	MessageTypePTYCloseErr  = "pty.close.error"
	MessageTypePTYExit      = "pty.exit"
)

const (
	ChannelKindAgent = "agent"
	ChannelKindPTY   = "pty"
)

const (
	PTYSessionModeCreate = "create"
	PTYSessionModeAttach = "attach"
)

// AgentConnectRequest requests a passthrough connection to the single agent endpoint.
type AgentConnectRequest struct {
	Type      string              `json:"type" jsonschema:"enum=connect"`
	V         int                 `json:"v" jsonschema:"enum=1"`
	RequestID string              `json:"requestId"`
	Channel   AgentConnectChannel `json:"channel"`
}

type AgentConnectChannel struct {
	Kind string `json:"kind" jsonschema:"enum=agent"`
}

// PTYConnectRequest requests creation or attachment to a PTY session.
type PTYConnectRequest struct {
	Type      string            `json:"type" jsonschema:"enum=connect"`
	V         int               `json:"v" jsonschema:"enum=1"`
	RequestID string            `json:"requestId"`
	Channel   PTYConnectChannel `json:"channel"`
}

type PTYConnectChannel struct {
	Kind    string `json:"kind" jsonschema:"enum=pty"`
	Session string `json:"session" jsonschema:"enum=create,enum=attach"`
	Cols    int    `json:"cols,omitempty" jsonschema:"minimum=1"`
	Rows    int    `json:"rows,omitempty" jsonschema:"minimum=1"`
	Cwd     string `json:"cwd,omitempty"`
}

// ConnectOK acknowledges a successful connect request.
type ConnectOK struct {
	Type      string `json:"type" jsonschema:"enum=connect.ok"`
	RequestID string `json:"requestId"`
}

// ConnectError reports a connect request failure.
type ConnectError struct {
	Type      string `json:"type" jsonschema:"enum=connect.error"`
	RequestID string `json:"requestId"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}

// Disconnect reports that the opposite tunnel peer disconnected and the current
// relay session should end while keeping the bootstrap tunnel alive.
type Disconnect struct {
	Type   string `json:"type" jsonschema:"enum=disconnect"`
	Reason string `json:"reason,omitempty"`
}

// PTYResize resizes the active PTY session.
type PTYResize struct {
	Type string `json:"type" jsonschema:"enum=pty.resize"`
	Cols int    `json:"cols" jsonschema:"minimum=1"`
	Rows int    `json:"rows" jsonschema:"minimum=1"`
}

// PTYClose requests PTY session termination.
type PTYClose struct {
	Type      string `json:"type" jsonschema:"enum=pty.close"`
	RequestID string `json:"requestId"`
}

// PTYCloseOK acknowledges clean PTY session termination.
type PTYCloseOK struct {
	Type      string `json:"type" jsonschema:"enum=pty.close.ok"`
	RequestID string `json:"requestId"`
	ExitCode  int    `json:"exitCode"`
}

// PTYCloseError reports PTY close failure.
type PTYCloseError struct {
	Type      string `json:"type" jsonschema:"enum=pty.close.error"`
	RequestID string `json:"requestId"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}

// PTYExit reports that the PTY process has exited.
type PTYExit struct {
	Type     string `json:"type" jsonschema:"enum=pty.exit"`
	ExitCode int    `json:"exitCode"`
}
