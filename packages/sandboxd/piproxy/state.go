package piproxy

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mistle/sandboxd/cgroups"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/supervision"
)

const piRPCResponseTimeout = 30 * time.Second

type State struct {
	config           Config
	child            *piRPCChild
	childMutex       sync.Mutex
	commandMutex     sync.Mutex
	eventSubscribers []chan []byte
	eventMutex       sync.Mutex
	keepaliveManager *keepalive.SharedManager
	idempotencyStore *SharedIdempotencyStore
	active           atomic.Bool
	activityMonitor  atomic.Bool
	nextID           atomic.Uint64
	supervisorHandle *supervision.SandboxdSupervisorHandle
	platformScope    *PlatformScope
}

type piRPCChild struct {
	command  *exec.Cmd
	stdin    io.WriteCloser
	output   chan piRPCOutput
	cwd      *string
	readerWG sync.WaitGroup
	done     chan error
}

type piRPCOutput struct {
	value map[string]any
	err   error
	eof   bool
}

func NewState(
	config Config,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	idempotencyStore *SharedIdempotencyStore,
	platformScope *PlatformScope,
) *State {
	state := &State{
		config:           config,
		keepaliveManager: keepaliveManager,
		idempotencyStore: idempotencyStore,
		supervisorHandle: supervisorHandle,
		platformScope:    platformScope,
	}
	state.nextID.Store(1)
	return state
}

func (state *State) EnsureChild(cwd *string) error {
	state.childMutex.Lock()
	defer state.childMutex.Unlock()
	if state.child != nil {
		if !state.childExited(state.child) && !shouldReplaceChildForCWD(state.child, cwd) {
			return nil
		}
		if state.childExited(state.child) {
			state.markPiRPCProcessRestarting("Pi RPC process exited")
		}
	}
	if state.child != nil {
		child := state.child
		state.child = nil
		state.terminateChild(child)
		state.setActive(false)
		state.markPiRPCProcessStopped()
		if err := state.killAndRemovePlatformScope(); err != nil {
			return err
		}
	}
	state.markPiRPCProcessStarting()
	command := exec.Command(state.config.PiCLIPath, "--mode", "rpc")
	if cwd != nil {
		command.Dir = *cwd
	}
	command.Env = commandEnvironment(state.config.Env)
	command.Stderr = os.Stderr
	stdin, err := command.StdinPipe()
	if err != nil {
		state.markPiRPCProcessRestarting(err.Error())
		return fmt.Errorf("spawned Pi RPC process did not expose stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		state.markPiRPCProcessRestarting(err.Error())
		return fmt.Errorf("spawned Pi RPC process did not expose stdout: %w", err)
	}
	if err := command.Start(); err != nil {
		state.markPiRPCProcessRestarting(err.Error())
		_ = state.killAndRemovePlatformScope()
		return fmt.Errorf("failed to spawn Pi RPC process: %w", err)
	}
	if err := state.registerPlatformScope(uint32(command.Process.Pid)); err != nil {
		state.markPiRPCProcessRestarting(err.Error())
		_ = command.Process.Kill()
		_ = state.killAndRemovePlatformScope()
		return err
	}
	child := &piRPCChild{
		command: command,
		stdin:   stdin,
		output:  make(chan piRPCOutput, 64),
		cwd:     cloneStringPointer(cwd),
		done:    make(chan error, 1),
	}
	child.readerWG.Add(1)
	go readPiRPCStdout(stdout, child.output, &child.readerWG)
	go func() {
		child.done <- command.Wait()
		close(child.done)
	}()
	state.child = child
	state.markPiRPCProcessHealthy(command.Process.Pid)
	return nil
}

func (state *State) ShutdownChild() error {
	state.childMutex.Lock()
	child := state.child
	state.child = nil
	state.childMutex.Unlock()
	if child == nil {
		return nil
	}
	state.terminateChild(child)
	state.setActive(false)
	state.markPiRPCProcessStopped()
	return state.killAndRemovePlatformScope()
}

func (state *State) SendCommand(command map[string]any) (map[string]any, error) {
	return state.SendCommandWithCapturedEvents(command, nil)
}

func (state *State) SendCommandWithCapturedEvents(command map[string]any, capturedEvents *[]map[string]any) (map[string]any, error) {
	state.commandMutex.Lock()
	defer state.commandMutex.Unlock()
	id := state.nextPiRequestID()
	command["id"] = id
	serialized, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	serialized = append(serialized, '\n')
	child, err := state.currentChild()
	if err != nil {
		return nil, err
	}
	if _, err := child.stdin.Write(serialized); err != nil {
		state.markPiRPCProcessRestarting(err.Error())
		return nil, fmt.Errorf("failed to write Pi RPC command: %w", err)
	}

	deadline := time.After(piRPCResponseTimeout)
	for {
		select {
		case output := <-child.output:
			if output.err != nil {
				state.markPiRPCProcessRestarting(output.err.Error())
				return nil, output.err
			}
			if output.eof {
				message := "Pi RPC process stdout closed"
				state.markPiRPCProcessRestarting(message)
				return nil, errors.New(message)
			}
			state.updateActivityFromPiOutput(output.value)
			if output.value["type"] == "response" && output.value["id"] == id {
				if output.value["success"] == true {
					if data, ok := output.value["data"].(map[string]any); ok {
						return data, nil
					}
					return map[string]any{}, nil
				}
				if message, ok := output.value["error"].(string); ok && message != "" {
					return nil, errors.New(message)
				}
				return nil, fmt.Errorf("Pi RPC command failed")
			}
			if capturedEvents != nil {
				*capturedEvents = append(*capturedEvents, output.value)
			} else {
				state.BroadcastEvent(output.value)
			}
		case <-deadline:
			return nil, fmt.Errorf("timed out waiting for Pi RPC response %q", id)
		}
	}
}

func (state *State) SubscribeEvents() <-chan []byte {
	channel := make(chan []byte, 64)
	state.eventMutex.Lock()
	state.eventSubscribers = append(state.eventSubscribers, channel)
	state.eventMutex.Unlock()
	return channel
}

func (state *State) BroadcastEvent(event map[string]any) {
	notification := RenderPiEventJSONRPCNotification(event)
	state.eventMutex.Lock()
	defer state.eventMutex.Unlock()
	subscribers := state.eventSubscribers[:0]
	for _, subscriber := range state.eventSubscribers {
		select {
		case subscriber <- notification:
			subscribers = append(subscribers, subscriber)
		default:
			subscribers = append(subscribers, subscriber)
		}
	}
	state.eventSubscribers = subscribers
}

func (state *State) SwitchSession(sessionFile string, capturedEvents *[]map[string]any) error {
	_, err := state.SendCommandWithCapturedEvents(map[string]any{
		"type":        "switch_session",
		"sessionPath": sessionFile,
	}, capturedEvents)
	return err
}

func (state *State) MarkActiveAndStartActivityMonitor() {
	state.setActive(true)
	if !state.activityMonitor.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer state.activityMonitor.Store(false)
		for state.active.Load() {
			if _, err := state.SendCommand(map[string]any{"type": "get_state"}); err != nil {
				state.setActive(false)
				return
			}
			time.Sleep(time.Second)
		}
	}()
}

func (state *State) StartChildMonitor(stop <-chan struct{}) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			state.childMutex.Lock()
			child := state.child
			exited := child != nil && state.childExited(child)
			state.childMutex.Unlock()
			if exited {
				_ = state.EnsureChild(nil)
			}
		}
	}
}

func (state *State) currentChild() (*piRPCChild, error) {
	state.childMutex.Lock()
	defer state.childMutex.Unlock()
	if state.child == nil {
		return nil, fmt.Errorf("Pi RPC process is not running")
	}
	return state.child, nil
}

func (state *State) nextPiRequestID() string {
	next := state.nextID.Add(1) - 1
	return fmt.Sprintf("mistle_pi_%d", next)
}

func (state *State) terminateChild(child *piRPCChild) {
	terminateCommand(child.command, child.done)
	child.readerWG.Wait()
}

func (state *State) childExited(child *piRPCChild) bool {
	select {
	case _, ok := <-child.done:
		if !ok {
			return true
		}
		return true
	default:
		return false
	}
}

func (state *State) registerPlatformScope(pid uint32) error {
	if state.platformScope == nil {
		return nil
	}
	if err := cgroups.AttachPIDToScope(state.platformScope.ScopePaths, pid); err != nil {
		return fmt.Errorf("failed to manage Pi platform scope: %w", err)
	}
	if err := state.platformScope.Registry.ReplaceScope(
		state.platformScope.RegistryKey,
		state.platformScope.ProcessKey,
		state.platformScope.ScopePaths,
		pid,
	); err != nil {
		return fmt.Errorf("failed to manage Pi platform scope: %w", err)
	}
	return nil
}

func (state *State) killAndRemovePlatformScope() error {
	if state.platformScope == nil {
		return nil
	}
	if err := cgroups.KillScope(state.platformScope.ScopePaths); err != nil {
		return fmt.Errorf("failed to manage Pi platform scope: %w", err)
	}
	if err := state.platformScope.Registry.RemoveScope(state.platformScope.RegistryKey); err != nil {
		return fmt.Errorf("failed to manage Pi platform scope: %w", err)
	}
	return nil
}

func (state *State) setActive(active bool) {
	previous := state.active.Swap(active)
	if previous == active {
		return
	}
	state.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		manager.SetPlatformActive(active)
	})
}

func (state *State) updateActivityFromPiOutput(value map[string]any) {
	switch value["type"] {
	case "agent_start":
		state.setActive(true)
	case "agent_end":
		state.setActive(false)
	case "response":
		if value["command"] == "get_state" && value["success"] == true {
			data, _ := value["data"].(map[string]any)
			active := boolValue(data["isStreaming"]) ||
				boolValue(data["isCompacting"]) ||
				numberValue(data["pendingMessageCount"]) > 0
			state.setActive(active)
		}
	}
}

func (state *State) markPiRPCProcessStarting() {
	if !state.supervisorHandle.TracksComponent(supervision.ComponentPiRpcProcess) {
		return
	}
	state.supervisorHandle.ReplaceComponentDetails(supervision.ComponentPiRpcProcess, map[string]string{
		"cliPath": state.config.PiCLIPath,
	})
	state.supervisorHandle.MarkComponentStarting(supervision.ComponentPiRpcProcess)
}

func (state *State) markPiRPCProcessHealthy(pid int) {
	if !state.supervisorHandle.TracksComponent(supervision.ComponentPiRpcProcess) {
		return
	}
	state.supervisorHandle.ReplaceComponentDetails(supervision.ComponentPiRpcProcess, map[string]string{
		"cliPath": state.config.PiCLIPath,
		"pid":     fmt.Sprint(pid),
	})
	state.supervisorHandle.MarkComponentHealthy(supervision.ComponentPiRpcProcess)
}

func (state *State) markPiRPCProcessRestarting(errorMessage string) {
	if !state.supervisorHandle.TracksComponent(supervision.ComponentPiRpcProcess) {
		return
	}
	state.supervisorHandle.MarkComponentRestarting(supervision.ComponentPiRpcProcess, errorMessage)
}

func (state *State) markPiRPCProcessStopped() {
	if !state.supervisorHandle.TracksComponent(supervision.ComponentPiRpcProcess) {
		return
	}
	state.supervisorHandle.MarkComponentStopped(supervision.ComponentPiRpcProcess)
}

func readPiRPCStdout(stdout io.Reader, output chan<- piRPCOutput, waitGroup *sync.WaitGroup) {
	defer waitGroup.Done()
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		var value map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			output <- piRPCOutput{err: err}
			continue
		}
		output <- piRPCOutput{value: value}
	}
	if err := scanner.Err(); err != nil {
		output <- piRPCOutput{err: err}
		return
	}
	output <- piRPCOutput{eof: true}
}

func shouldReplaceChildForCWD(child *piRPCChild, requestedCWD *string) bool {
	return child.cwd == nil && requestedCWD != nil
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func numberValue(value any) float64 {
	result, _ := value.(float64)
	return result
}
