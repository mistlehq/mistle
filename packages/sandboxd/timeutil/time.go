package timeutil

import (
	"sync"
	"time"
)

type Clock interface {
	NowMS() uint64
	NowSystemTime() time.Time
}

type SystemClock struct{}

func (SystemClock) NowMS() uint64 {
	return uint64(time.Now().UnixMilli())
}

func (SystemClock) NowSystemTime() time.Time {
	return time.Now()
}

type Sleeper interface {
	Sleep(duration time.Duration)
}

type ThreadSleeper struct{}

func (ThreadSleeper) Sleep(duration time.Duration) {
	time.Sleep(duration)
}

func SubtractMillis(base time.Time, durationMS uint64) time.Time {
	duration := time.Duration(durationMS) * time.Millisecond
	result := base.Add(-duration)
	if result.After(base) {
		return base
	}
	return result
}

func AddMillis(base time.Time, durationMS uint64) time.Time {
	duration := time.Duration(durationMS) * time.Millisecond
	result := base.Add(duration)
	if result.Before(base) {
		return base
	}
	return result
}

func FormatRFC3339Timestamp(systemTime time.Time) string {
	return systemTime.UTC().Format("2006-01-02T15:04:05.999Z")
}

type MutableClock struct {
	mutex sync.Mutex
	nowMS uint64
}

func NewMutableClock(initialNowMS uint64) *MutableClock {
	return &MutableClock{nowMS: initialNowMS}
}

func (clock *MutableClock) NowMS() uint64 {
	clock.mutex.Lock()
	defer clock.mutex.Unlock()
	return clock.nowMS
}

func (clock *MutableClock) NowSystemTime() time.Time {
	return time.UnixMilli(int64(clock.NowMS()))
}

func (clock *MutableClock) AdvanceMS(durationMS uint64) {
	clock.mutex.Lock()
	defer clock.mutex.Unlock()
	clock.nowMS += durationMS
}

type ManualSleeper struct {
	condition          *sync.Cond
	requestedDurations []time.Duration
}

func NewManualSleeper() *ManualSleeper {
	return &ManualSleeper{condition: sync.NewCond(&sync.Mutex{})}
}

func (sleeper *ManualSleeper) Sleep(duration time.Duration) {
	sleeper.condition.L.Lock()
	defer sleeper.condition.L.Unlock()
	sleeper.requestedDurations = append(sleeper.requestedDurations, duration)
	sleeper.condition.Broadcast()
}

func (sleeper *ManualSleeper) RequestedDurations() []time.Duration {
	sleeper.condition.L.Lock()
	defer sleeper.condition.L.Unlock()
	durations := make([]time.Duration, len(sleeper.requestedDurations))
	copy(durations, sleeper.requestedDurations)
	return durations
}

func (sleeper *ManualSleeper) WaitForSleepRequests(count int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	sleeper.condition.L.Lock()
	defer sleeper.condition.L.Unlock()
	for len(sleeper.requestedDurations) < count {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return false
		}
		timer := time.AfterFunc(remaining, func() {
			sleeper.condition.L.Lock()
			defer sleeper.condition.L.Unlock()
			sleeper.condition.Broadcast()
		})
		sleeper.condition.Wait()
		timer.Stop()
	}
	return true
}
