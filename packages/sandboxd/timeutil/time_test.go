package timeutil

import (
	"slices"
	"testing"
	"time"
)

func TestMutableClockAdvancesTime(t *testing.T) {
	clock := NewMutableClock(100)

	clock.AdvanceMS(25)

	assertEqual(t, clock.NowMS(), uint64(125))
	assertEqual(t, clock.NowSystemTime(), time.UnixMilli(125))
}

func TestManualSleeperRecordsRequestedDurations(t *testing.T) {
	sleeper := NewManualSleeper()

	sleeper.Sleep(5 * time.Millisecond)
	sleeper.Sleep(9 * time.Millisecond)

	expected := []time.Duration{5 * time.Millisecond, 9 * time.Millisecond}
	if !slices.Equal(sleeper.RequestedDurations(), expected) {
		t.Fatalf("expected %v, got %v", expected, sleeper.RequestedDurations())
	}
}

func TestManualSleeperWaitsForRecordedRequests(t *testing.T) {
	sleeper := NewManualSleeper()
	done := make(chan bool, 1)
	go func() {
		done <- sleeper.WaitForSleepRequests(1, time.Second)
	}()

	sleeper.Sleep(1 * time.Millisecond)

	assertEqual(t, <-done, true)
}

func TestThreadSleeperImplementsSleeper(t *testing.T) {
	ThreadSleeper{}.Sleep(0)
}

func TestSystemClockReadsEpochMilliseconds(t *testing.T) {
	clock := SystemClock{}

	if clock.NowMS() == 0 {
		t.Fatalf("expected system clock epoch milliseconds")
	}
	if clock.NowSystemTime().Before(time.UnixMilli(0)) {
		t.Fatalf("expected system clock after unix epoch")
	}
}

func TestTimeHelpersShiftSystemTimeByMilliseconds(t *testing.T) {
	base := time.Unix(10, 0)

	assertEqual(t, SubtractMillis(base, 250), time.UnixMilli(9750))
	assertEqual(t, AddMillis(base, 500), time.UnixMilli(10500))
}

func TestFormatRFC3339Timestamp(t *testing.T) {
	timestamp := FormatRFC3339Timestamp(time.UnixMilli(104))

	assertEqual(t, timestamp, "1970-01-01T00:00:00.104Z")
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
