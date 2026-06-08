//go:build linux

package egressproxy

import (
	"fmt"
	"sort"

	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
)

func discoverLocalDestinationIPv4CIDRs() ([]string, error) {
	routes, err := netlink.RouteListFiltered(
		netlink.FAMILY_V4,
		&netlink.Route{Table: unix.RT_TABLE_MAIN, Scope: netlink.SCOPE_LINK},
		netlink.RT_FILTER_TABLE|netlink.RT_FILTER_SCOPE,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query transparent proxy local destination routes with rtnetlink: %w", err)
	}
	cidrs := make([]string, 0, len(routes))
	for _, route := range routes {
		if route.Dst == nil {
			continue
		}
		cidr, err := normalizeIPv4RouteDestination(route.Dst.String())
		if err != nil {
			return nil, err
		}
		cidrs = append(cidrs, cidr)
	}
	sort.Strings(cidrs)
	return dedupeStrings(cidrs), nil
}
