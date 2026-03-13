package sessionprotocol

const (
	MessageTypeStreamOpen      = "stream.open"
	MessageTypeStreamOpenOK    = "stream.open.ok"
	MessageTypeStreamOpenError = "stream.open.error"
	MessageTypeDisconnect      = "disconnect"
	MessageTypePTYResize       = "pty.resize"
	MessageTypePTYClose        = "pty.close"
	MessageTypePTYCloseOK      = "pty.close.ok"
	MessageTypePTYCloseErr     = "pty.close.error"
	MessageTypePTYExit         = "pty.exit"
)

const (
	ChannelKindAgent = "agent"
	ChannelKindPTY   = "pty"
)

const (
	PTYSessionModeCreate = "create"
	PTYSessionModeAttach = "attach"
)

// StreamOpen requests opening a logical stream on the interactive websocket.
type StreamOpen struct {
	Type     string            `json:"type" jsonschema:"enum=stream.open"`
	StreamID int               `json:"streamId"`
	Channel  StreamOpenChannel `json:"channel"`
}

type StreamOpenChannel struct {
	Kind    string `json:"kind" jsonschema:"enum=agent,enum=pty"`
	Session string `json:"session,omitempty" jsonschema:"enum=create,enum=attach"`
	Cols    int    `json:"cols,omitempty" jsonschema:"minimum=1"`
	Rows    int    `json:"rows,omitempty" jsonschema:"minimum=1"`
	Cwd     string `json:"cwd,omitempty"`
}

// StreamOpenOK acknowledges a successful stream.open request.
type StreamOpenOK struct {
	Type     string `json:"type" jsonschema:"enum=stream.open.ok"`
	StreamID int    `json:"streamId"`
}

// StreamOpenError reports a stream.open request failure.
type StreamOpenError struct {
	Type     string `json:"type" jsonschema:"enum=stream.open.error"`
	StreamID int    `json:"streamId"`
	Code     string `json:"code"`
	Message  string `json:"message"`
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
