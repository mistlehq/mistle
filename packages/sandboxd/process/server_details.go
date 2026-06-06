package process

import (
	"fmt"

	"github.com/mistle/sandboxd/runtime"
)

const (
	CodexAppServerProcessKey = "codex-app-server"
	OpenCodeServerProcessKey = "opencode-server"
)

type RuntimeClientProcessSpec struct {
	ProcessKey string
	Readiness  runtime.RuntimeClientProcessReadiness
}

type CodexAppServerObservation struct {
	ProcessKey     string
	PID            *uint32
	ReadinessURL   *string
	IsAlive        bool
	LastExitStatus *string
}

func IsCodexAppServerProcess(processSpec RuntimeClientProcessSpec) bool {
	return processSpec.ProcessKey == CodexAppServerProcessKey
}

func IsOpenCodeServerProcess(processSpec RuntimeClientProcessSpec) bool {
	return processSpec.ProcessKey == OpenCodeServerProcessKey
}

func CodexAppServerDetails(processSpec RuntimeClientProcessSpec, pid *uint32) map[string]string {
	details := map[string]string{"processKey": processSpec.ProcessKey}
	if processSpec.Readiness.Type == runtime.RuntimeClientProcessReadinessWS {
		details["readinessUrl"] = processSpec.Readiness.URL
	}
	if pid != nil {
		details["pid"] = fmt.Sprint(*pid)
	}
	return details
}

func CodexAppServerReadinessURL(processSpec RuntimeClientProcessSpec) *string {
	if processSpec.Readiness.Type != runtime.RuntimeClientProcessReadinessWS {
		return nil
	}
	url := processSpec.Readiness.URL
	return &url
}

func CodexAppServerDetailsWithStatus(
	processSpec RuntimeClientProcessSpec,
	pid *uint32,
	lastExitStatus *string,
	livenessState string,
	readinessState string,
) map[string]string {
	details := CodexAppServerDetails(processSpec, pid)
	details["livenessState"] = livenessState
	details["readinessState"] = readinessState
	if lastExitStatus != nil {
		details["lastExitStatus"] = *lastExitStatus
	}
	return details
}

func UpdateCodexAppServerObservation(
	observation *CodexAppServerObservation,
	processSpec RuntimeClientProcessSpec,
	pid *uint32,
	isAlive bool,
	lastExitStatus *string,
) error {
	if observation == nil {
		return fmt.Errorf("codex app-server observation is required")
	}
	observation.ProcessKey = processSpec.ProcessKey
	observation.PID = pid
	observation.ReadinessURL = CodexAppServerReadinessURL(processSpec)
	observation.IsAlive = isAlive
	observation.LastExitStatus = lastExitStatus
	return nil
}

func OpenCodeServerDetails(processSpec RuntimeClientProcessSpec, pid *uint32) map[string]string {
	details := map[string]string{"processKey": processSpec.ProcessKey}
	if processSpec.Readiness.Type == runtime.RuntimeClientProcessReadinessHTTP {
		details["readinessUrl"] = processSpec.Readiness.URL
	}
	if pid != nil {
		details["pid"] = fmt.Sprint(*pid)
	}
	return details
}

func OpenCodeServerDetailsWithStatus(
	processSpec RuntimeClientProcessSpec,
	pid *uint32,
	lastExitStatus *string,
	livenessState string,
	readinessState string,
) map[string]string {
	details := OpenCodeServerDetails(processSpec, pid)
	details["livenessState"] = livenessState
	details["readinessState"] = readinessState
	if lastExitStatus != nil {
		details["lastExitStatus"] = *lastExitStatus
	}
	return details
}
