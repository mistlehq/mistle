package sessionprotocol

const (
	MessageTypeStreamOpen      = "stream.open"
	MessageTypeStreamOpenOK    = "stream.open.ok"
	MessageTypeStreamOpenError = "stream.open.error"
	MessageTypeStreamSignal    = "stream.signal"
	MessageTypeStreamEvent     = "stream.event"
	MessageTypeStreamClose     = "stream.close"
	MessageTypeStreamReset     = "stream.reset"
	MessageTypeStreamWindow    = "stream.window"
	MessageTypeDisconnect      = "disconnect"
	MessageTypePTYResize       = "pty.resize"
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

// PTYResizeSignal resizes the active PTY session for a stream.
type PTYResizeSignal struct {
	Type string `json:"type" jsonschema:"enum=pty.resize"`
	Cols int    `json:"cols" jsonschema:"minimum=1"`
	Rows int    `json:"rows" jsonschema:"minimum=1"`
}

// StreamSignal delivers a control signal to an active stream.
type StreamSignal struct {
	Type     string          `json:"type" jsonschema:"enum=stream.signal"`
	StreamID int             `json:"streamId"`
	Signal   PTYResizeSignal `json:"signal"`
}

// PTYExitEvent reports that a PTY-backed stream has exited.
type PTYExitEvent struct {
	Type     string `json:"type" jsonschema:"enum=pty.exit"`
	ExitCode int    `json:"exitCode"`
}

// StreamEvent reports an event emitted by an active stream.
type StreamEvent struct {
	Type     string       `json:"type" jsonschema:"enum=stream.event"`
	StreamID int          `json:"streamId"`
	Event    PTYExitEvent `json:"event"`
}

// StreamClose requests shutdown of an active stream.
type StreamClose struct {
	Type     string `json:"type" jsonschema:"enum=stream.close"`
	StreamID int    `json:"streamId"`
}

// StreamReset reports that an active stream was terminated due to a stream-specific error.
type StreamReset struct {
	Type     string `json:"type" jsonschema:"enum=stream.reset"`
	StreamID int    `json:"streamId"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// StreamWindow grants per-stream receive capacity to the opposite peer.
type StreamWindow struct {
	Type     string `json:"type" jsonschema:"enum=stream.window"`
	StreamID int    `json:"streamId"`
	Bytes    int    `json:"bytes"`
}

// Disconnect reports that the opposite tunnel peer disconnected and the current
// relay session should end while keeping the bootstrap tunnel alive.
type Disconnect struct {
	Type   string `json:"type" jsonschema:"enum=disconnect"`
	Reason string `json:"reason,omitempty"`
}
