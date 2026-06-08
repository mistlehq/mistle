package codexproxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/keepalive"
)

func TestSessionManagerAppliesAsyncThreadStatusNotifications(t *testing.T) {
	sendIdle := make(chan struct{})
	unsubscribed := make(chan struct{}, 1)
	rawServer := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		ctx := request.Context()

		initialize := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": initialize["id"], "result": map[string]any{}})
		_ = readSessionManagerTestJSON(t, ctx, connection)
		loadedList := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": loadedList["id"], "result": map[string]any{"data": []any{}}})

		resume := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, resume["method"], threadResumeMethod)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{
			"id": resume["id"],
			"result": map[string]any{
				"thread": map[string]any{
					"status": map[string]any{"type": "active", "activeFlags": []string{"background"}},
				},
			},
		})
		select {
		case <-sendIdle:
		case <-ctx.Done():
			return
		}
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{
			"method": "thread/status/changed",
			"params": map[string]any{
				"threadId": "thread_123",
				"status":   map[string]any{"type": "idle"},
			},
		})

		unsubscribe := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, unsubscribe["method"], threadUnsubscribeMethod)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": unsubscribe["id"], "result": map[string]any{}})
		unsubscribed <- struct{}{}
		<-ctx.Done()
	}))
	t.Cleanup(rawServer.Close)

	keepaliveManager := keepalive.NewSharedManager()
	handle := StartSessionManager("ws"+strings.TrimPrefix(rawServer.URL, "http"), keepaliveManager, &recordingSessionManagerHealthSink{})
	t.Cleanup(handle.Close)

	requireNoError(t, handle.RetainThread("thread_123", RetainReasonMistleAgentBackgroundExecution))
	waitForSessionManagerCondition(t, func() bool { return keepaliveManager.Active() })
	close(sendIdle)
	select {
	case <-unsubscribed:
	case <-time.After(time.Second):
		t.Fatalf("expected session manager to unsubscribe after idle status notification")
	}
	waitForSessionManagerCondition(t, func() bool { return !keepaliveManager.Active() })
}

func TestSessionManagerRetainAndReleaseManageSubscriptions(t *testing.T) {
	unsubscribed := make(chan struct{}, 1)
	rawServer := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		ctx := request.Context()

		initialize := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": initialize["id"], "result": map[string]any{}})
		initialized := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, initialized["method"], "initialized")
		loadedList := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": loadedList["id"], "result": map[string]any{"data": []any{}}})

		resume := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, resume["method"], threadResumeMethod)
		resumeParams := resume["params"].(map[string]any)
		assertEqual(t, resumeParams["threadId"], "thread_123")
		assertEqual(t, resumeParams["excludeTurns"], true)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{
			"id": resume["id"],
			"result": map[string]any{
				"thread": map[string]any{
					"id":     "thread_123",
					"status": map[string]any{"type": "active", "activeFlags": []any{}},
				},
			},
		})

		unsubscribe := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, unsubscribe["method"], threadUnsubscribeMethod)
		unsubscribeParams := unsubscribe["params"].(map[string]any)
		assertEqual(t, unsubscribeParams["threadId"], "thread_123")
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": unsubscribe["id"], "result": map[string]any{"status": "unsubscribed"}})
		unsubscribed <- struct{}{}
		<-ctx.Done()
	}))
	t.Cleanup(rawServer.Close)

	keepaliveManager := keepalive.NewSharedManager()
	handle := StartSessionManager("ws"+strings.TrimPrefix(rawServer.URL, "http"), keepaliveManager, &recordingSessionManagerHealthSink{})
	t.Cleanup(handle.Close)

	requireNoError(t, handle.RetainThread("thread_123", RetainReasonMistleAgentBackgroundExecution))
	waitForSessionManagerCondition(t, func() bool { return keepaliveManager.Active() })
	requireNoError(t, handle.ReleaseThread("thread_123", RetainReasonMistleAgentBackgroundExecution))
	select {
	case <-unsubscribed:
	case <-time.After(time.Second):
		t.Fatalf("expected explicit release to unsubscribe retained thread")
	}
}

func TestSessionManagerReportsConnectedBeforeRetainedReplayCompletes(t *testing.T) {
	resumeReceived := make(chan struct{}, 1)
	allowResumeResponse := make(chan struct{})
	var allowResumeResponseOnce sync.Once
	allowResume := func() {
		allowResumeResponseOnce.Do(func() {
			close(allowResumeResponse)
		})
	}
	rawServer := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		ctx := request.Context()

		initialize := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": initialize["id"], "result": map[string]any{}})
		initialized := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, initialized["method"], "initialized")
		loadedList := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": loadedList["id"], "result": map[string]any{"data": []any{}}})

		resume := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, resume["method"], threadResumeMethod)
		resumeReceived <- struct{}{}
		select {
		case <-allowResumeResponse:
		case <-ctx.Done():
			return
		}
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{
			"id": resume["id"],
			"result": map[string]any{
				"thread": map[string]any{
					"id":     "thread_123",
					"status": map[string]any{"type": "active", "activeFlags": []any{}},
				},
			},
		})
		<-ctx.Done()
	}))
	t.Cleanup(rawServer.Close)

	healthSink := &recordingSessionManagerHealthSink{}
	stop := make(chan struct{})
	state := SessionManagerState{
		RetainedThreads: map[string]RetainedThreadState{
			"thread_123": {
				RetainReasons: map[RetainReason]struct{}{
					RetainReasonMistleAgentBackgroundExecution: {},
				},
				SubscriptionState: ThreadSubscriptionRequested,
			},
		},
		NextRequestID: 3,
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		runSessionManagerSession(
			"ws"+strings.TrimPrefix(rawServer.URL, "http"),
			keepalive.NewSharedManager(),
			healthSink,
			make(chan sessionManagerCommand),
			stop,
			NewMonitor(),
			&state,
		)
	}()
	t.Cleanup(func() {
		allowResume()
		close(stop)
		<-done
	})

	select {
	case <-resumeReceived:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for retained replay request")
	}
	if !healthSink.hasState(SessionManagerConnected) {
		t.Fatalf("expected connected health before retained replay completed, got %v", healthSink.snapshot())
	}
	allowResume()
}

func TestSessionManagerRetriesLiveRetainWhenRolloutIsEmpty(t *testing.T) {
	restoreRetryInterval := useTestLiveRetainRetryInterval(time.Millisecond)
	defer restoreRetryInterval()
	resumeAttempts := make(chan int, 2)
	rawServer := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		ctx := request.Context()

		initialize := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": initialize["id"], "result": map[string]any{}})
		_ = readSessionManagerTestJSON(t, ctx, connection)
		loadedList := readSessionManagerTestJSON(t, ctx, connection)
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{"id": loadedList["id"], "result": map[string]any{"data": []any{}}})

		firstResume := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, firstResume["method"], threadResumeMethod)
		resumeAttempts <- 1
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{
			"id": firstResume["id"],
			"error": map[string]any{
				"message": "rollout at 123 is empty",
			},
		})

		secondResume := readSessionManagerTestJSON(t, ctx, connection)
		assertEqual(t, secondResume["method"], threadResumeMethod)
		resumeAttempts <- 2
		writeSessionManagerTestJSON(t, ctx, connection, map[string]any{
			"id": secondResume["id"],
			"result": map[string]any{
				"thread": map[string]any{
					"status": map[string]any{"type": "active", "activeFlags": []string{"background"}},
				},
			},
		})
		<-ctx.Done()
	}))
	t.Cleanup(rawServer.Close)

	keepaliveManager := keepalive.NewSharedManager()
	handle := StartSessionManager("ws"+strings.TrimPrefix(rawServer.URL, "http"), keepaliveManager, &recordingSessionManagerHealthSink{})
	t.Cleanup(handle.Close)

	requireNoError(t, handle.RetainThread("thread_retry", RetainReasonMistleAgentBackgroundExecution))
	assertEqual(t, receiveSessionManagerAttempt(t, resumeAttempts), 1)
	assertEqual(t, receiveSessionManagerAttempt(t, resumeAttempts), 2)
	waitForSessionManagerCondition(t, func() bool { return keepaliveManager.Active() })
}

func TestSessionManagerClassifiesRetainAndReleaseResponseMessages(t *testing.T) {
	if !isMissingThreadMessage("No rollout found for thread id thread_123") {
		t.Fatalf("expected missing rollout message to be treated as missing thread")
	}
	if !shouldRetryLiveRetainThreadResume("rollout at 123 is empty") {
		t.Fatalf("expected empty rollout message to be retryable")
	}
	if shouldRetryLiveRetainThreadResume("rollout at 123 is unavailable") {
		t.Fatalf("expected non-empty rollout message shape not to be retryable")
	}
	if !isReleaseSuccessMessage("Thread subscription NotSubscribed") {
		t.Fatalf("expected NotSubscribed release message to be treated as success")
	}
	if !isReleaseSuccessMessage("Thread subscription NotLoaded") {
		t.Fatalf("expected NotLoaded release message to be treated as success")
	}
}

type recordingSessionManagerHealthSink struct {
	mu     sync.Mutex
	states []SessionManagerHealthState
}

func (sink *recordingSessionManagerHealthSink) SetSessionManagerHealth(state SessionManagerHealthState) {
	sink.mu.Lock()
	defer sink.mu.Unlock()
	sink.states = append(sink.states, state)
}

func (sink *recordingSessionManagerHealthSink) hasState(state SessionManagerHealthState) bool {
	sink.mu.Lock()
	defer sink.mu.Unlock()
	for _, observed := range sink.states {
		if observed == state {
			return true
		}
	}
	return false
}

func (sink *recordingSessionManagerHealthSink) snapshot() []SessionManagerHealthState {
	sink.mu.Lock()
	defer sink.mu.Unlock()
	return append([]SessionManagerHealthState(nil), sink.states...)
}

func readSessionManagerTestJSON(t *testing.T, ctx context.Context, connection *websocket.Conn) map[string]any {
	t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	_, payload, err := connection.Read(readCtx)
	requireNoError(t, err)
	var decoded map[string]any
	requireNoError(t, json.Unmarshal(payload, &decoded))
	return decoded
}

func writeSessionManagerTestJSON(t *testing.T, ctx context.Context, connection *websocket.Conn, value any) {
	t.Helper()
	writeCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	serialized, err := json.Marshal(value)
	requireNoError(t, err)
	requireNoError(t, connection.Write(writeCtx, websocket.MessageText, serialized))
}

func waitForSessionManagerCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition was not met before deadline")
}

func receiveSessionManagerAttempt(t *testing.T, attempts <-chan int) int {
	t.Helper()
	select {
	case attempt := <-attempts:
		return attempt
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for session manager resume attempt")
		return 0
	}
}

func useTestLiveRetainRetryInterval(interval time.Duration) func() {
	previous := LiveRetainRetryInterval
	LiveRetainRetryInterval = interval
	return func() {
		LiveRetainRetryInterval = previous
	}
}
