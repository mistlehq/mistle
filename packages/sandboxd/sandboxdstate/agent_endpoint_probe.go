package sandboxdstate

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

const (
	RuntimeProbeInterval = 100 * time.Millisecond
	RuntimeProbeTimeout  = 500 * time.Millisecond
)

type RuntimeAgentProbePlan struct {
	AgentEndpointURL string
	RuntimeProbe     RuntimeSpecificProbe
}

type RuntimeSpecificProbe interface {
	runtimeSpecificProbe()
}

type CodexRuntimeProbe struct{}

func (CodexRuntimeProbe) runtimeSpecificProbe() {}

type OpenCodeRuntimeProbe struct {
	ProxyURL       string
	HealthPath     string
	ExpectedStatus uint16
}

func (OpenCodeRuntimeProbe) runtimeSpecificProbe() {}

type PiRuntimeProbe struct {
	ProxyURL string
}

func (PiRuntimeProbe) runtimeSpecificProbe() {}

type RuntimeAgentProbeHandle struct {
	shutdown chan struct{}
	done     chan struct{}
	once     sync.Once
}

func StartRuntimeAgentProbe(
	plan RuntimeAgentProbePlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	sleeper timeutil.Sleeper,
) (*RuntimeAgentProbeHandle, error) {
	if _, ok := plan.RuntimeProbe.(CodexRuntimeProbe); !ok {
		if _, ok := plan.RuntimeProbe.(OpenCodeRuntimeProbe); !ok {
			if _, ok := plan.RuntimeProbe.(PiRuntimeProbe); !ok {
				return nil, fmt.Errorf("unsupported runtime probe type %T", plan.RuntimeProbe)
			}
		}
	}
	handle := &RuntimeAgentProbeHandle{
		shutdown: make(chan struct{}),
		done:     make(chan struct{}),
	}
	goroutineCount := 1
	if _, ok := plan.RuntimeProbe.(CodexRuntimeProbe); !ok {
		goroutineCount = 2
	}
	done := make(chan struct{}, goroutineCount)

	go func() {
		runRuntimeAgentEndpointProbeLoop(plan.AgentEndpointURL, supervisorHandle, sleeper, handle.shutdown)
		done <- struct{}{}
	}()

	switch runtimeProbe := plan.RuntimeProbe.(type) {
	case CodexRuntimeProbe:
	case OpenCodeRuntimeProbe:
		go func() {
			runOpenCodeProxyConnectivityProbeLoop(
				runtimeProbe.ProxyURL,
				runtimeProbe.HealthPath,
				runtimeProbe.ExpectedStatus,
				supervisorHandle,
				sleeper,
				handle.shutdown,
			)
			done <- struct{}{}
		}()
	case PiRuntimeProbe:
		go func() {
			runPiProxyConnectivityProbeLoop(runtimeProbe.ProxyURL, supervisorHandle, sleeper, handle.shutdown)
			done <- struct{}{}
		}()
	}

	go func() {
		for range goroutineCount {
			<-done
		}
		close(handle.done)
	}()
	return handle, nil
}

func (handle *RuntimeAgentProbeHandle) Close() {
	handle.once.Do(func() {
		close(handle.shutdown)
		<-handle.done
	})
}

func runRuntimeAgentEndpointProbeLoop(
	agentEndpointURL string,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	sleeper timeutil.Sleeper,
	shutdown <-chan struct{},
) {
	component := supervision.ComponentRuntimeAgentEndpoint
	supervisorHandle.ReplaceComponentDetails(component, map[string]string{"endpointUrl": agentEndpointURL})
	supervisorHandle.MarkComponentStarting(component)

	for !shutdownRequested(shutdown) {
		err := CheckWebSocketHandshake(agentEndpointURL)
		if err == nil {
			markProbeHealthy(supervisorHandle, component, map[string]string{
				"endpointUrl":       agentEndpointURL,
				"connectivityState": "Connected",
			})
		} else {
			markProbeFailure(supervisorHandle, component, map[string]string{
				"endpointUrl": agentEndpointURL,
			}, err.Error(), "agent_endpoint_websocket")
		}
		sleeper.Sleep(RuntimeProbeInterval)
	}
}

func runOpenCodeProxyConnectivityProbeLoop(
	proxyURL string,
	healthPath string,
	expectedStatus uint16,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	sleeper timeutil.Sleeper,
	shutdown <-chan struct{},
) {
	component := supervision.ComponentOpenCodeProxyConnectivity
	supervisorHandle.ReplaceComponentDetails(component, map[string]string{
		"proxyUrl":       proxyURL,
		"healthPath":     healthPath,
		"expectedStatus": fmt.Sprint(expectedStatus),
	})
	supervisorHandle.MarkComponentStarting(component)

	for !shutdownRequested(shutdown) {
		observedStatus, err := CheckOpenCodeProxyConnectivity(proxyURL, healthPath, expectedStatus)
		if err == nil {
			markProbeHealthy(supervisorHandle, component, map[string]string{
				"proxyUrl":          proxyURL,
				"healthPath":        healthPath,
				"expectedStatus":    fmt.Sprint(expectedStatus),
				"observedStatus":    fmt.Sprint(observedStatus),
				"connectivityState": "Connected",
			})
		} else {
			markProbeFailure(supervisorHandle, component, map[string]string{
				"proxyUrl":       proxyURL,
				"healthPath":     healthPath,
				"expectedStatus": fmt.Sprint(expectedStatus),
			}, err.Error(), "opencode_proxy_health")
		}
		sleeper.Sleep(RuntimeProbeInterval)
	}
}

func runPiProxyConnectivityProbeLoop(
	proxyURL string,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	sleeper timeutil.Sleeper,
	shutdown <-chan struct{},
) {
	component := supervision.ComponentPiProxyConnectivity
	supervisorHandle.ReplaceComponentDetails(component, map[string]string{
		"proxyUrl":      proxyURL,
		"requestMethod": "pi/getState",
	})
	supervisorHandle.MarkComponentStarting(component)

	for !shutdownRequested(shutdown) {
		err := CheckPiProxyConnectivity(proxyURL)
		if err == nil {
			markProbeHealthy(supervisorHandle, component, map[string]string{
				"proxyUrl":          proxyURL,
				"requestMethod":     "pi/getState",
				"connectivityState": "Connected",
			})
		} else {
			markProbeFailure(supervisorHandle, component, map[string]string{
				"proxyUrl":      proxyURL,
				"requestMethod": "pi/getState",
			}, err.Error(), "pi_proxy_get_state")
		}
		sleeper.Sleep(RuntimeProbeInterval)
	}
}

func markProbeHealthy(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
	details map[string]string,
) {
	supervisorHandle.ReplaceComponentDetails(component, details)
	supervisorHandle.MarkComponentHealthy(component)
	supervisorHandle.RecordComponentHealthcheck(component)
}

func markProbeFailure(
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	component supervision.SupervisedComponent,
	details map[string]string,
	errorText string,
	probeKind string,
) {
	isAlreadyRestarting := false
	if snapshot := supervisorHandle.ComponentSnapshot(component); snapshot != nil {
		isAlreadyRestarting = snapshot.State == supervision.ComponentRestarting
	}
	details["connectivityState"] = "Disconnected"
	details["lastProbeError"] = errorText
	supervisorHandle.ReplaceComponentDetails(component, details)
	if isAlreadyRestarting {
		return
	}
	supervisorHandle.MarkComponentRestarting(component, errorText)
	supervisorHandle.EmitComponentHealthcheckFailed(component, "runtime_probe_failed", errorText, probeKind, nil)
}

func CheckWebSocketHandshake(rawURL string) error {
	connection, err := connectProbeWebSocket(rawURL)
	if err != nil {
		return err
	}
	return closeProbeWebSocket(connection, "websocket probe")
}

func CheckOpenCodeProxyConnectivity(proxyURL string, healthPath string, expectedStatus uint16) (uint16, error) {
	connection, err := connectProbeWebSocket(proxyURL)
	if err != nil {
		return 0, err
	}
	defer connection.CloseNow()

	request := map[string]any{
		"id":          "sandboxd-opencode-health",
		"method":      http.MethodGet,
		"path":        healthPath,
		"headers":     nil,
		"body":        nil,
		"idempotency": nil,
	}
	if err := writeProbeJSON(connection, request, "OpenCode proxy health request"); err != nil {
		return 0, err
	}
	response, err := readProbeJSONObject(connection)
	if err != nil {
		return 0, err
	}
	status, ok := response["status"].(float64)
	if !ok {
		return 0, fmt.Errorf("OpenCode proxy health response did not include status: %s", jsonObjectString(response))
	}
	observedStatus := uint16(status)
	if float64(observedStatus) != status {
		return 0, fmt.Errorf("OpenCode proxy health response status was outside uint16 range: %s", jsonObjectString(response))
	}
	if observedStatus != expectedStatus {
		return 0, fmt.Errorf("OpenCode proxy health returned status %d, expected %d", observedStatus, expectedStatus)
	}
	if err := closeProbeWebSocket(connection, "OpenCode proxy health socket"); err != nil {
		return 0, err
	}
	return observedStatus, nil
}

func CheckPiProxyConnectivity(proxyURL string) error {
	connection, err := connectProbeWebSocket(proxyURL)
	if err != nil {
		return err
	}
	defer connection.CloseNow()

	request := map[string]any{
		"jsonrpc": "2.0",
		"id":      "sandboxd-pi-health",
		"method":  "pi/getState",
	}
	if err := writeProbeJSON(connection, request, "Pi proxy health request"); err != nil {
		return err
	}
	response, err := readJSONRPCResponseWithID(connection, "sandboxd-pi-health")
	if err != nil {
		return err
	}
	if _, ok := response["error"]; ok {
		return fmt.Errorf("Pi proxy health returned an error response: %s", jsonObjectString(response))
	}
	if _, ok := response["result"]; !ok {
		return fmt.Errorf("Pi proxy health response did not include result: %s", jsonObjectString(response))
	}
	return closeProbeWebSocket(connection, "Pi proxy health socket")
}

func connectProbeWebSocket(rawURL string) (*websocket.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), RuntimeProbeTimeout)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("websocket probe connection failed: %w", err)
	}
	return connection, nil
}

func writeProbeJSON(connection *websocket.Conn, payload map[string]any, description string) error {
	serialized, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to serialize %s: %w", description, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), RuntimeProbeTimeout)
	defer cancel()
	if err := connection.Write(ctx, websocket.MessageText, serialized); err != nil {
		return fmt.Errorf("failed to send %s: %w", description, err)
	}
	return nil
}

func readProbeJSONObject(connection *websocket.Conn) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), RuntimeProbeTimeout)
	defer cancel()
	messageType, payload, err := connection.Read(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to read websocket probe response: %w", err)
	}
	if messageType != websocket.MessageText {
		return nil, fmt.Errorf("websocket probe expected text response, received %s", messageType.String())
	}
	var response map[string]any
	if err := json.Unmarshal(payload, &response); err != nil {
		return nil, fmt.Errorf("websocket probe response was not json: %w", err)
	}
	return response, nil
}

func readJSONRPCResponseWithID(connection *websocket.Conn, expectedID string) (map[string]any, error) {
	for {
		response, err := readProbeJSONObject(connection)
		if err != nil {
			return nil, err
		}
		if id, ok := response["id"].(string); ok && id == expectedID {
			return response, nil
		}
	}
}

func closeProbeWebSocket(connection *websocket.Conn, description string) error {
	if err := connection.Close(websocket.StatusNormalClosure, ""); err != nil {
		return fmt.Errorf("failed to close %s: %w", description, err)
	}
	return nil
}

func shutdownRequested(shutdown <-chan struct{}) bool {
	select {
	case <-shutdown:
		return true
	default:
		return false
	}
}

func jsonObjectString(value map[string]any) string {
	serialized, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%#v", value)
	}
	return string(serialized)
}
