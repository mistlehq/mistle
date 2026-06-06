package codexproxy

import (
	"slices"
	"testing"

	"github.com/mistle/sandboxd/keepalive"
)

func TestParseThreadStatusChangedMessageIgnoresNonThreadStatusNotifications(t *testing.T) {
	parsed, err := ParseThreadStatusChangedMessage([]byte(`{"method":"turn/completed","params":{"turn":{"id":"turn_123","status":"completed"}}}`))
	requireNoError(t, err)

	if parsed != nil {
		t.Fatalf("expected non-thread notification to be ignored")
	}
}

func TestParseThreadStatusChangedMessageReadsActiveStatus(t *testing.T) {
	parsed, err := ParseThreadStatusChangedMessage([]byte(`{"method":"thread/status/changed","params":{"threadId":"thr_123","status":{"type":"active","activeFlags":["background"]}}}`))
	requireNoError(t, err)
	if parsed == nil {
		t.Fatalf("expected thread status update")
	}

	assertEqual(t, parsed.ThreadID, "thr_123")
	assertEqual(t, parsed.Status.Kind, ThreadStatusActive)
	if !slices.Equal(parsed.Status.ActiveFlags, []string{"background"}) {
		t.Fatalf("expected active flags, got %v", parsed.Status.ActiveFlags)
	}
}

func TestParseThreadLoadedListResponseRejectsNonStringThreadIDs(t *testing.T) {
	_, err := ParseThreadLoadedListResponse([]byte(`{"result":{"data":["thr_1",7]}}`))

	assertError(t, err, "thread/loaded/list response contains a non-string thread id")
}

func TestMonitorRebuildSetsPlatformActivityFromActiveThreads(t *testing.T) {
	monitor := NewMonitor()
	keepaliveManager := &keepalive.Manager{}

	monitor.RebuildFromThreads(map[string]ThreadStatus{
		"thr_active": {Kind: ThreadStatusActive},
		"thr_idle":   {Kind: ThreadStatusIdle},
	}, keepaliveManager)

	if !slices.Equal(monitor.ActiveThreadIDs(), []string{"thr_active"}) {
		t.Fatalf("expected active thread id, got %v", monitor.ActiveThreadIDs())
	}
	assertEqual(t, keepaliveManager.Active(), true)
}

func TestMonitorApplyThreadStatusAndClearUpdateKeepalive(t *testing.T) {
	monitor := NewMonitor()
	keepaliveManager := &keepalive.Manager{}

	monitor.ApplyThreadStatus("thr_1", ThreadStatus{Kind: ThreadStatusActive}, keepaliveManager)
	assertEqual(t, keepaliveManager.Active(), true)
	monitor.ApplyThreadStatus("thr_1", ThreadStatus{Kind: ThreadStatusIdle}, keepaliveManager)
	assertEqual(t, keepaliveManager.Active(), false)
	monitor.ApplyThreadStatus("thr_2", ThreadStatus{Kind: ThreadStatusActive}, keepaliveManager)
	monitor.Clear(keepaliveManager)
	assertEqual(t, monitor.HasActiveThreads(), false)
	assertEqual(t, keepaliveManager.Active(), false)
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertError(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %q, got nil", expected)
	}
	assertEqual(t, err.Error(), expected)
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
