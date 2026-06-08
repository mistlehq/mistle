//go:build linux

package egressproxy

import (
	"github.com/vishvananda/netlink"
)

type netlinkTransparentRouteEventMonitor struct {
	done   chan struct{}
	events chan struct{}
}

func startTransparentRouteEventMonitor() (transparentRouteEventMonitor, error) {
	done := make(chan struct{})
	events := make(chan struct{}, 1)
	routeUpdates := make(chan netlink.RouteUpdate)
	linkUpdates := make(chan netlink.LinkUpdate)
	addressUpdates := make(chan netlink.AddrUpdate)
	if err := netlink.RouteSubscribe(routeUpdates, done); err != nil {
		close(done)
		return nil, err
	}
	if err := netlink.LinkSubscribe(linkUpdates, done); err != nil {
		close(done)
		return nil, err
	}
	if err := netlink.AddrSubscribe(addressUpdates, done); err != nil {
		close(done)
		return nil, err
	}
	emitTransparentProxyDiagnostic("egress_proxy_local_destination_monitor_started", map[string]any{
		"source": "rtnetlink",
		"groups": []string{"link", "ipv4_ifaddr", "ipv4_route"},
	})
	go runNetlinkTransparentRouteEventMonitor(done, events, routeUpdates, linkUpdates, addressUpdates)
	return &netlinkTransparentRouteEventMonitor{done: done, events: events}, nil
}

func (monitor *netlinkTransparentRouteEventMonitor) Close() {
	close(monitor.done)
}

func (monitor *netlinkTransparentRouteEventMonitor) Events() <-chan struct{} {
	return monitor.events
}

func runNetlinkTransparentRouteEventMonitor(
	done <-chan struct{},
	events chan<- struct{},
	routeUpdates <-chan netlink.RouteUpdate,
	linkUpdates <-chan netlink.LinkUpdate,
	addressUpdates <-chan netlink.AddrUpdate,
) {
	defer close(events)
	for {
		select {
		case <-done:
			return
		case _, ok := <-routeUpdates:
			if !ok {
				return
			}
			sendTransparentRouteEvent(events)
		case _, ok := <-linkUpdates:
			if !ok {
				return
			}
			sendTransparentRouteEvent(events)
		case _, ok := <-addressUpdates:
			if !ok {
				return
			}
			sendTransparentRouteEvent(events)
		}
	}
}

func sendTransparentRouteEvent(events chan<- struct{}) {
	select {
	case events <- struct{}{}:
	default:
	}
}
