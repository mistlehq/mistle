package tunnel

import "time"

const (
	DefaultPTYCols                  uint16 = 80
	DefaultPTYRows                  uint16 = 24
	DefaultPTYShell                        = "/bin/bash"
	DefaultPTYTerm                         = "xterm-256color"
	DefaultPTYTerminatePollInterval        = 10 * time.Millisecond
	DefaultPTYTerminateTimeout             = 2 * time.Second
)

type PTYSpawnRequest struct {
	CWD     *string
	Cols    *uint16
	Rows    *uint16
	Command *string
	Args    []string
	Env     map[string]string
}

type PTYEventKind string

const (
	PTYEventOutput PTYEventKind = "output"
	PTYEventExit   PTYEventKind = "exit"
	PTYEventClosed PTYEventKind = "closed"
	PTYEventError  PTYEventKind = "error"
)

type PTYEvent struct {
	Kind     PTYEventKind
	Output   []byte
	ExitCode int
	Error    string
}
