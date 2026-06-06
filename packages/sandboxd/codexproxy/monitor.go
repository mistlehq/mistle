package codexproxy

import (
	"sort"

	"github.com/mistle/sandboxd/keepalive"
)

type Monitor struct {
	activeThreads map[string]struct{}
}

func NewMonitor() *Monitor {
	return &Monitor{activeThreads: map[string]struct{}{}}
}

func (monitor *Monitor) HasActiveThreads() bool {
	return len(monitor.activeThreads) > 0
}

func (monitor *Monitor) ActiveThreadIDs() []string {
	threadIDs := make([]string, 0, len(monitor.activeThreads))
	for threadID := range monitor.activeThreads {
		threadIDs = append(threadIDs, threadID)
	}
	sort.Strings(threadIDs)
	return threadIDs
}

func (monitor *Monitor) ApplyThreadStatus(threadID string, status ThreadStatus, keepaliveManager *keepalive.Manager) {
	if status.IsActive() {
		monitor.activeThreads[threadID] = struct{}{}
	} else {
		delete(monitor.activeThreads, threadID)
	}
	keepaliveManager.SetPlatformActive(monitor.HasActiveThreads())
}

func (monitor *Monitor) RebuildFromThreads(threads map[string]ThreadStatus, keepaliveManager *keepalive.Manager) {
	clear(monitor.activeThreads)
	for threadID, status := range threads {
		if status.IsActive() {
			monitor.activeThreads[threadID] = struct{}{}
		}
	}
	keepaliveManager.SetPlatformActive(monitor.HasActiveThreads())
}

func (monitor *Monitor) Clear(keepaliveManager *keepalive.Manager) {
	clear(monitor.activeThreads)
	keepaliveManager.SetPlatformActive(false)
}
