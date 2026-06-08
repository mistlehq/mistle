//go:build !linux

package egressproxy

func startTransparentRouteEventMonitor() (transparentRouteEventMonitor, error) {
	monitor := &noopTransparentRouteEventMonitor{events: make(chan struct{})}
	return monitor, nil
}

type noopTransparentRouteEventMonitor struct {
	events chan struct{}
}

func (monitor *noopTransparentRouteEventMonitor) Close() {
	close(monitor.events)
}

func (monitor *noopTransparentRouteEventMonitor) Events() <-chan struct{} {
	return monitor.events
}
