package codexproxy

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/keepalive"
)

const (
	SessionManagerReconnectInterval = 100 * time.Millisecond
	LiveRetainMaxAttempts           = 200
)

var LiveRetainRetryInterval = 100 * time.Millisecond

const (
	threadResumeMethod      = "thread/resume"
	threadUnsubscribeMethod = "thread/unsubscribe"
)

type RetainReason string

const RetainReasonMistleAgentBackgroundExecution RetainReason = "mistle_agent_background_execution"

type SessionManagerHealthState string

const (
	SessionManagerStarting     SessionManagerHealthState = "Starting"
	SessionManagerConnected    SessionManagerHealthState = "Connected"
	SessionManagerDisconnected SessionManagerHealthState = "Disconnected"
)

type ThreadSubscriptionState string

const (
	ThreadSubscriptionRequested  ThreadSubscriptionState = "Requested"
	ThreadSubscriptionSubscribed ThreadSubscriptionState = "Subscribed"
)

type RetainedThreadState struct {
	RetainReasons     map[RetainReason]struct{}
	LastStatus        *ThreadStatus
	SubscriptionState ThreadSubscriptionState
}

type SessionManagerState struct {
	RetainedThreads          map[string]RetainedThreadState
	NextRequestID            int64
	Initialized              bool
	RetentionReplayInProcess bool
}

type SessionManagerHandle struct {
	commands chan sessionManagerCommand
	stop     chan struct{}
	done     chan struct{}
	once     sync.Once
}

type sessionManagerCommand struct {
	kind     sessionManagerCommandKind
	threadID string
	reason   RetainReason
	reply    chan error
}

type sessionManagerCommandKind string

const (
	sessionManagerCommandRetain  sessionManagerCommandKind = "retain"
	sessionManagerCommandRelease sessionManagerCommandKind = "release"
	sessionManagerCommandRestart sessionManagerCommandKind = "restart"
	sessionManagerCommandStop    sessionManagerCommandKind = "stop"
)

type codexIncomingMessage struct {
	response map[string]any
	payload  []byte
	err      error
}

type responseWaiter func(context.Context, int64, *[]ThreadStatusUpdate) (map[string]any, []byte, error)

type HealthStateSink interface {
	SetSessionManagerHealth(SessionManagerHealthState)
}

func StartSessionManager(rawAppServerURL string, keepaliveManager *keepalive.SharedManager, healthSink HealthStateSink) *SessionManagerHandle {
	handle := &SessionManagerHandle{
		commands: make(chan sessionManagerCommand, 32),
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
	go func() {
		defer close(handle.done)
		runSessionManagerLoop(rawAppServerURL, keepaliveManager, healthSink, handle.commands, handle.stop)
	}()
	return handle
}

func (handle *SessionManagerHandle) RetainThread(threadID string, reason RetainReason) error {
	return handle.command(sessionManagerCommand{kind: sessionManagerCommandRetain, threadID: threadID, reason: reason})
}

func (handle *SessionManagerHandle) ReleaseThread(threadID string, reason RetainReason) error {
	return handle.command(sessionManagerCommand{kind: sessionManagerCommandRelease, threadID: threadID, reason: reason})
}

func (handle *SessionManagerHandle) Restart() error {
	return handle.enqueue(sessionManagerCommand{kind: sessionManagerCommandRestart})
}

func (handle *SessionManagerHandle) Close() {
	handle.once.Do(func() {
		close(handle.stop)
		<-handle.done
	})
}

func (handle *SessionManagerHandle) command(command sessionManagerCommand) error {
	command.reply = make(chan error, 1)
	select {
	case handle.commands <- command:
	case <-handle.done:
		return fmt.Errorf("Codex session manager command channel is closed")
	}
	select {
	case err := <-command.reply:
		return err
	case <-handle.done:
		return fmt.Errorf("Codex session manager command channel is closed")
	}
}

func (handle *SessionManagerHandle) enqueue(command sessionManagerCommand) error {
	select {
	case handle.commands <- command:
		return nil
	case <-handle.done:
		return fmt.Errorf("Codex session manager command channel is closed")
	default:
		return fmt.Errorf("Codex session manager command channel is full")
	}
}

func runSessionManagerLoop(
	rawAppServerURL string,
	keepaliveManager *keepalive.SharedManager,
	healthSink HealthStateSink,
	commands <-chan sessionManagerCommand,
	stop <-chan struct{},
) {
	monitor := NewMonitor()
	state := SessionManagerState{RetainedThreads: map[string]RetainedThreadState{}, NextRequestID: 3}
	for {
		select {
		case <-stop:
			return
		default:
		}
		healthSink.SetSessionManagerHealth(SessionManagerStarting)
		shouldStop := runSessionManagerSession(rawAppServerURL, keepaliveManager, healthSink, commands, stop, monitor, &state)
		keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
			monitor.Clear(manager)
		})
		healthSink.SetSessionManagerHealth(SessionManagerDisconnected)
		state.Initialized = false
		state.RetentionReplayInProcess = false
		markAllRetainedThreadsRequested(&state)
		if shouldStop {
			return
		}
		select {
		case <-stop:
			return
		case <-time.After(SessionManagerReconnectInterval):
		}
	}
}

func runSessionManagerSession(
	rawAppServerURL string,
	keepaliveManager *keepalive.SharedManager,
	healthSink HealthStateSink,
	commands <-chan sessionManagerCommand,
	stop <-chan struct{},
	monitor *Monitor,
	state *SessionManagerState,
) bool {
	ctx := context.Background()
	connection, _, err := websocket.Dial(ctx, rawAppServerURL, nil)
	if err != nil {
		return false
	}
	defer connection.CloseNow()

	if err := initializeSession(ctx, connection); err != nil {
		return false
	}
	loadedThreadIDs, pendingUpdates, err := readLoadedThreadIDs(ctx, connection)
	if err != nil {
		return false
	}
	loadedThreads, moreUpdates, err := readLoadedThreads(ctx, connection, state, loadedThreadIDs)
	if err != nil {
		return false
	}
	pendingUpdates = append(pendingUpdates, moreUpdates...)
	for _, loadedThread := range loadedThreads {
		pendingUpdates = append(pendingUpdates, loadedThread)
	}
	if err := applyPendingUpdates(ctx, connection, directResponseWaiter(connection), state, monitor, keepaliveManager, pendingUpdates); err != nil {
		return false
	}
	state.Initialized = true
	healthSink.SetSessionManagerHealth(SessionManagerConnected)
	if err := replayRetainedThreads(ctx, connection, state, monitor, keepaliveManager); err != nil {
		return false
	}

	incoming := startCodexIncomingReader(ctx, connection)
	waitForLiveResponse := incomingResponseWaiter(incoming)
	for {
		select {
		case <-stop:
			return true
		case command, ok := <-commands:
			if !ok {
				return true
			}
			if command.kind == sessionManagerCommandStop {
				if command.reply != nil {
					command.reply <- nil
				}
				return true
			}
			if command.kind == sessionManagerCommandRestart {
				if command.reply != nil {
					command.reply <- nil
				}
				return false
			}
			err := handleSessionManagerCommand(ctx, connection, waitForLiveResponse, state, monitor, keepaliveManager, command)
			if command.reply != nil {
				command.reply <- err
			}
			if isTransportCommandError(err) {
				return false
			}
		case message, ok := <-incoming:
			if !ok {
				return false
			}
			if message.err != nil {
				return false
			}
			update, err := ParseThreadStatusChangedMessage(message.payload)
			if err != nil {
				return false
			}
			if update != nil {
				if err := applyPendingUpdates(ctx, connection, waitForLiveResponse, state, monitor, keepaliveManager, []ThreadStatusUpdate{*update}); err != nil {
					return false
				}
			}
		}
	}
}

func startCodexIncomingReader(ctx context.Context, connection *websocket.Conn) <-chan codexIncomingMessage {
	incoming := make(chan codexIncomingMessage, 32)
	go func() {
		defer close(incoming)
		for {
			response, payload, err := ReadJSONObject(ctx, connection)
			message := codexIncomingMessage{response: response, payload: payload, err: err}
			select {
			case incoming <- message:
			case <-ctx.Done():
				return
			}
			if err != nil {
				return
			}
		}
	}()
	return incoming
}

func initializeSession(ctx context.Context, connection *websocket.Conn) error {
	if err := SendJSON(ctx, connection, map[string]any{
		"method": "initialize",
		"id":     int64(1),
		"params": map[string]any{
			"clientInfo": map[string]any{
				"name":    InitializeClientName,
				"title":   InitializeClientTitle,
				"version": InitializeClientVersion,
			},
			"capabilities": map[string]any{"experimentalApi": true},
		},
	}); err != nil {
		return err
	}
	if _, _, err := waitForResponse(ctx, connection, 1); err != nil {
		return err
	}
	return SendJSON(ctx, connection, map[string]any{"method": "initialized", "params": map[string]any{}})
}

func readLoadedThreadIDs(ctx context.Context, connection *websocket.Conn) ([]string, []ThreadStatusUpdate, error) {
	pendingUpdates := []ThreadStatusUpdate{}
	if err := SendJSON(ctx, connection, map[string]any{"method": "thread/loaded/list", "id": int64(2), "params": map[string]any{}}); err != nil {
		return nil, nil, err
	}
	_, payload, err := waitForResponseCollectingUpdates(ctx, connection, 2, &pendingUpdates)
	if err != nil {
		return nil, nil, err
	}
	threadIDs, err := ParseThreadLoadedListResponse(payload)
	return threadIDs, pendingUpdates, err
}

func readLoadedThreads(
	ctx context.Context,
	connection *websocket.Conn,
	state *SessionManagerState,
	threadIDs []string,
) ([]ThreadStatusUpdate, []ThreadStatusUpdate, error) {
	threads := []ThreadStatusUpdate{}
	pendingUpdates := []ThreadStatusUpdate{}
	for _, threadID := range threadIDs {
		requestID := nextRequestID(state)
		if err := SendJSON(ctx, connection, map[string]any{
			"method": "thread/read",
			"id":     requestID,
			"params": map[string]any{"threadId": threadID},
		}); err != nil {
			return nil, nil, err
		}
		response, payload, err := waitForResponseCollectingUpdates(ctx, connection, requestID, &pendingUpdates)
		if err != nil {
			return nil, nil, err
		}
		status, err := ParseThreadReadResponse(payload)
		if err != nil {
			return nil, nil, err
		}
		observedThreadID := threadID
		if result, ok := response["result"].(map[string]any); ok {
			if thread, ok := result["thread"].(map[string]any); ok {
				if value, ok := thread["id"].(string); ok {
					observedThreadID = value
				}
			}
		}
		threads = append(threads, ThreadStatusUpdate{ThreadID: observedThreadID, Status: status})
	}
	return threads, pendingUpdates, nil
}

func waitForResponse(ctx context.Context, connection *websocket.Conn, requestID int64) (map[string]any, []byte, error) {
	pendingUpdates := []ThreadStatusUpdate{}
	return waitForResponseCollectingUpdates(ctx, connection, requestID, &pendingUpdates)
}

func waitForResponseCollectingUpdates(
	ctx context.Context,
	connection *websocket.Conn,
	requestID int64,
	pendingUpdates *[]ThreadStatusUpdate,
) (map[string]any, []byte, error) {
	for {
		response, payload, err := ReadJSONObject(ctx, connection)
		if err != nil {
			return nil, nil, err
		}
		if ResponseMatchesID(response, requestID) {
			return response, payload, nil
		}
		update, err := ParseThreadStatusChangedMessage(payload)
		if err != nil {
			return nil, nil, err
		}
		if update != nil {
			*pendingUpdates = append(*pendingUpdates, *update)
		}
	}
}

func directResponseWaiter(connection *websocket.Conn) responseWaiter {
	return func(ctx context.Context, requestID int64, pendingUpdates *[]ThreadStatusUpdate) (map[string]any, []byte, error) {
		return waitForResponseCollectingUpdates(ctx, connection, requestID, pendingUpdates)
	}
}

func incomingResponseWaiter(incoming <-chan codexIncomingMessage) responseWaiter {
	return func(ctx context.Context, requestID int64, pendingUpdates *[]ThreadStatusUpdate) (map[string]any, []byte, error) {
		for {
			select {
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			case message, ok := <-incoming:
				if !ok {
					return nil, nil, fmt.Errorf("Codex session manager incoming message channel is closed")
				}
				if message.err != nil {
					return nil, nil, message.err
				}
				if ResponseMatchesID(message.response, requestID) {
					return message.response, message.payload, nil
				}
				update, err := ParseThreadStatusChangedMessage(message.payload)
				if err != nil {
					return nil, nil, err
				}
				if update != nil {
					*pendingUpdates = append(*pendingUpdates, *update)
				}
			}
		}
	}
}

func handleSessionManagerCommand(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	monitor *Monitor,
	keepaliveManager *keepalive.SharedManager,
	command sessionManagerCommand,
) error {
	switch command.kind {
	case sessionManagerCommandRetain:
		return retainThread(ctx, connection, waitForResponse, state, monitor, keepaliveManager, command.threadID, command.reason)
	case sessionManagerCommandRelease:
		return releaseThread(ctx, connection, waitForResponse, state, monitor, keepaliveManager, command.threadID, command.reason)
	default:
		return nil
	}
}

func retainThread(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	monitor *Monitor,
	keepaliveManager *keepalive.SharedManager,
	threadID string,
	reason RetainReason,
) error {
	retained := state.RetainedThreads[threadID]
	if retained.RetainReasons == nil {
		retained.RetainReasons = map[RetainReason]struct{}{}
	}
	if _, ok := retained.RetainReasons[reason]; ok && retained.SubscriptionState == ThreadSubscriptionSubscribed {
		return nil
	}
	retained.RetainReasons[reason] = struct{}{}
	retained.SubscriptionState = ThreadSubscriptionRequested
	state.RetainedThreads[threadID] = retained

	status, pendingUpdates, err := issueThreadResumeWithRetry(ctx, connection, waitForResponse, state, threadID)
	if err != nil {
		delete(state.RetainedThreads, threadID)
		return err
	}
	retained = state.RetainedThreads[threadID]
	retained.LastStatus = &status
	retained.SubscriptionState = ThreadSubscriptionSubscribed
	state.RetainedThreads[threadID] = retained
	pendingUpdates = append([]ThreadStatusUpdate{{ThreadID: threadID, Status: status}}, pendingUpdates...)
	return applyPendingUpdates(ctx, connection, waitForResponse, state, monitor, keepaliveManager, pendingUpdates)
}

func releaseThread(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	monitor *Monitor,
	keepaliveManager *keepalive.SharedManager,
	threadID string,
	reason RetainReason,
) error {
	retained, ok := state.RetainedThreads[threadID]
	if !ok {
		return nil
	}
	if _, ok := retained.RetainReasons[reason]; !ok {
		return nil
	}
	if len(retained.RetainReasons) > 1 {
		delete(retained.RetainReasons, reason)
		state.RetainedThreads[threadID] = retained
		return nil
	}
	if retained.SubscriptionState == ThreadSubscriptionSubscribed {
		pendingUpdates, err := unsubscribeThread(ctx, connection, waitForResponse, state, threadID)
		if err != nil {
			if isReleaseSuccessMessage(err.Error()) {
				delete(state.RetainedThreads, threadID)
				return nil
			}
			return err
		}
		delete(state.RetainedThreads, threadID)
		return applyPendingUpdates(ctx, connection, waitForResponse, state, monitor, keepaliveManager, pendingUpdates)
	}
	delete(state.RetainedThreads, threadID)
	return nil
}

func issueThreadResumeWithRetry(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	threadID string,
) (ThreadStatus, []ThreadStatusUpdate, error) {
	var lastErr error
	for attempt := 0; attempt < LiveRetainMaxAttempts; attempt++ {
		status, pendingUpdates, err := resumeThreadSubscription(ctx, connection, waitForResponse, state, threadID)
		if err == nil {
			return status, pendingUpdates, nil
		}
		lastErr = err
		if !shouldRetryLiveRetainThreadResume(err.Error()) || attempt+1 == LiveRetainMaxAttempts {
			break
		}
		time.Sleep(LiveRetainRetryInterval)
	}
	return ThreadStatus{}, nil, lastErr
}

func resumeThreadSubscription(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	threadID string,
) (ThreadStatus, []ThreadStatusUpdate, error) {
	requestID := nextRequestID(state)
	pendingUpdates := []ThreadStatusUpdate{}
	if err := SendJSON(ctx, connection, map[string]any{
		"method": threadResumeMethod,
		"id":     requestID,
		"params": map[string]any{"threadId": threadID, "excludeTurns": true},
	}); err != nil {
		return ThreadStatus{}, nil, err
	}
	response, payload, err := waitForResponse(ctx, requestID, &pendingUpdates)
	if err != nil {
		return ThreadStatus{}, nil, err
	}
	if message, ok := ResponseErrorMessage(response); ok {
		return ThreadStatus{}, nil, fmt.Errorf("%s", message)
	}
	status, err := ParseThreadReadResponse(payload)
	return status, pendingUpdates, err
}

func unsubscribeThread(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	threadID string,
) ([]ThreadStatusUpdate, error) {
	requestID := nextRequestID(state)
	pendingUpdates := []ThreadStatusUpdate{}
	if err := SendJSON(ctx, connection, map[string]any{
		"method": threadUnsubscribeMethod,
		"id":     requestID,
		"params": map[string]any{"threadId": threadID},
	}); err != nil {
		return nil, err
	}
	response, _, err := waitForResponse(ctx, requestID, &pendingUpdates)
	if err != nil {
		return nil, err
	}
	if message, ok := ResponseErrorMessage(response); ok {
		return nil, fmt.Errorf("%s", message)
	}
	return pendingUpdates, nil
}

func replayRetainedThreads(
	ctx context.Context,
	connection *websocket.Conn,
	state *SessionManagerState,
	monitor *Monitor,
	keepaliveManager *keepalive.SharedManager,
) error {
	state.RetentionReplayInProcess = true
	defer func() { state.RetentionReplayInProcess = false }()
	waitForResponse := directResponseWaiter(connection)
	threadIDs := make([]string, 0, len(state.RetainedThreads))
	for threadID := range state.RetainedThreads {
		threadIDs = append(threadIDs, threadID)
	}
	for _, threadID := range threadIDs {
		retained, ok := state.RetainedThreads[threadID]
		if !ok || len(retained.RetainReasons) == 0 || retained.SubscriptionState != ThreadSubscriptionRequested {
			continue
		}
		status, pendingUpdates, err := resumeThreadSubscription(ctx, connection, waitForResponse, state, threadID)
		if err != nil {
			if isMissingThreadMessage(err.Error()) {
				delete(state.RetainedThreads, threadID)
			}
			continue
		}
		retained.LastStatus = &status
		retained.SubscriptionState = ThreadSubscriptionSubscribed
		state.RetainedThreads[threadID] = retained
		pendingUpdates = append([]ThreadStatusUpdate{{ThreadID: threadID, Status: status}}, pendingUpdates...)
		if err := applyPendingUpdates(ctx, connection, waitForResponse, state, monitor, keepaliveManager, pendingUpdates); err != nil {
			return err
		}
	}
	return nil
}

func applyPendingUpdates(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	monitor *Monitor,
	keepaliveManager *keepalive.SharedManager,
	pendingUpdates []ThreadStatusUpdate,
) error {
	for len(pendingUpdates) > 0 {
		update := pendingUpdates[0]
		pendingUpdates = pendingUpdates[1:]
		additionalUpdates, err := applyOneThreadStatusUpdate(ctx, connection, waitForResponse, state, monitor, keepaliveManager, update)
		if err != nil {
			return err
		}
		pendingUpdates = append(pendingUpdates, additionalUpdates...)
	}
	return nil
}

func applyOneThreadStatusUpdate(
	ctx context.Context,
	connection *websocket.Conn,
	waitForResponse responseWaiter,
	state *SessionManagerState,
	monitor *Monitor,
	keepaliveManager *keepalive.SharedManager,
	update ThreadStatusUpdate,
) ([]ThreadStatusUpdate, error) {
	keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		monitor.ApplyThreadStatus(update.ThreadID, update.Status, manager)
	})
	retained, ok := state.RetainedThreads[update.ThreadID]
	if !ok {
		return nil, nil
	}
	retained.LastStatus = &update.Status
	if update.Status.IsActive() {
		state.RetainedThreads[update.ThreadID] = retained
		return nil, nil
	}
	delete(retained.RetainReasons, RetainReasonMistleAgentBackgroundExecution)
	if len(retained.RetainReasons) > 0 {
		state.RetainedThreads[update.ThreadID] = retained
		return nil, nil
	}
	delete(state.RetainedThreads, update.ThreadID)
	if retained.SubscriptionState != ThreadSubscriptionSubscribed {
		return nil, nil
	}
	pendingUpdates, err := unsubscribeThread(ctx, connection, waitForResponse, state, update.ThreadID)
	if err != nil {
		if isReleaseSuccessMessage(err.Error()) {
			return nil, nil
		}
		return nil, err
	}
	return pendingUpdates, nil
}

func markAllRetainedThreadsRequested(state *SessionManagerState) {
	for threadID, retained := range state.RetainedThreads {
		retained.SubscriptionState = ThreadSubscriptionRequested
		state.RetainedThreads[threadID] = retained
	}
}

func nextRequestID(state *SessionManagerState) int64 {
	if state.NextRequestID < 3 {
		state.NextRequestID = 3
	}
	requestID := state.NextRequestID
	state.NextRequestID++
	return requestID
}

func isTransportCommandError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "failed to")
}

func isMissingThreadMessage(message string) bool {
	normalized := strings.ToLower(message)
	for _, pattern := range []string{"no rollout found for thread id", "thread not found", "references missing provider conversation", "invalid thread id"} {
		if strings.Contains(normalized, pattern) {
			return true
		}
	}
	return false
}

func isReleaseSuccessMessage(message string) bool {
	normalized := strings.ToLower(message)
	return strings.Contains(normalized, "notsubscribed") || strings.Contains(normalized, "notloaded")
}

func shouldRetryLiveRetainThreadResume(message string) bool {
	return isMissingThreadMessage(message) || (strings.Contains(message, "rollout at ") && strings.HasSuffix(message, " is empty"))
}
