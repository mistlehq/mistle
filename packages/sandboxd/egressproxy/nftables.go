package egressproxy

import (
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"sort"
	"strings"

	"github.com/mistle/sandboxd/protocol"
)

const (
	TransparentNftablesTableName = "mistle_transparent_egress"
	localDestinationSetName      = "local_destinations"
)

var StaticLocalDestinationIPv4CIDRs = []string{"127.0.0.0/8", "169.254.0.0/16"}

type NftablesRulePlan struct {
	TableName                 string
	ListenerPort              uint16
	PassthroughMark           uint32
	LocalDestinationIPv4CIDRs []string
	ExcludedIPv4CIDRs         []string
}

func BuildNftablesRulePlanWithLocalDestinations(
	configuration protocol.TransparentProxyConfiguration,
	listenerPort uint16,
	discoveredLocalDestinationIPv4CIDRs []string,
) (NftablesRulePlan, error) {
	if configuration.PassthroughBypass.Kind != protocol.TransparentProxyBypassSocketMark {
		return NftablesRulePlan{}, fmt.Errorf("transparent proxy packet rules require socket-mark passthrough bypass")
	}
	if configuration.PassthroughBypass.Mark == 0 {
		return NftablesRulePlan{}, fmt.Errorf("transparent proxy socket-mark bypass value must be non-zero")
	}

	excludedIPv4CIDRs, err := excludedIPv4CIDRs(configuration.Exclusions)
	if err != nil {
		return NftablesRulePlan{}, err
	}
	localDestinationIPv4CIDRs := append([]string(nil), StaticLocalDestinationIPv4CIDRs...)
	for _, cidr := range discoveredLocalDestinationIPv4CIDRs {
		normalizedCIDR, err := normalizeIPv4CIDR(cidr)
		if err != nil {
			return NftablesRulePlan{}, err
		}
		if normalizedCIDR != "" {
			localDestinationIPv4CIDRs = append(localDestinationIPv4CIDRs, normalizedCIDR)
		}
	}
	localDestinationIPv4CIDRs, err = canonicalizeIPv4IntervalSetCIDRs(localDestinationIPv4CIDRs)
	if err != nil {
		return NftablesRulePlan{}, err
	}
	excludedIPv4CIDRs = removeCIDRs(excludedIPv4CIDRs, localDestinationIPv4CIDRs)

	return NftablesRulePlan{
		TableName:                 TransparentNftablesTableName,
		ListenerPort:              listenerPort,
		PassthroughMark:           configuration.PassthroughBypass.Mark,
		LocalDestinationIPv4CIDRs: localDestinationIPv4CIDRs,
		ExcludedIPv4CIDRs:         excludedIPv4CIDRs,
	}, nil
}

func BuildNftablesInstallCommands(plan NftablesRulePlan) [][]string {
	commands := [][]string{
		{"add", "table", "ip", plan.TableName},
		{"add", "chain", "ip", plan.TableName, "output", "{", "type", "nat", "hook", "output", "priority", "-100", ";", "policy", "accept", ";", "}"},
		{"add", "set", "ip", plan.TableName, localDestinationSetName, "{", "type", "ipv4_addr", ";", "flags", "interval", ";", "}"},
		buildNftablesLocalDestinationSetAddCommand(plan.TableName, plan.LocalDestinationIPv4CIDRs),
		{"add", "rule", "ip", plan.TableName, "output", "meta", "mark", fmt.Sprint(plan.PassthroughMark), "counter", "return"},
		{"add", "rule", "ip", plan.TableName, "output", "ip", "daddr", "@" + localDestinationSetName, "counter", "return"},
	}
	for _, cidr := range plan.ExcludedIPv4CIDRs {
		commands = append(commands, []string{"add", "rule", "ip", plan.TableName, "output", "ip", "daddr", cidr, "counter", "return"})
	}
	commands = append(commands, []string{
		"add", "rule", "ip", plan.TableName, "output", "tcp", "dport", "1-65535", "counter", "redirect", "to", fmt.Sprintf(":%d", plan.ListenerPort),
	})
	return commands
}

func BuildNftablesLocalDestinationSetReplaceScript(tableName string, cidrs []string) string {
	commands := [][]string{
		{"flush", "set", "ip", tableName, localDestinationSetName},
		buildNftablesLocalDestinationSetAddCommand(tableName, cidrs),
	}
	lines := make([]string, 0, len(commands))
	for _, command := range commands {
		lines = append(lines, strings.Join(command, " "))
	}
	return strings.Join(lines, "\n") + "\n"
}

func ParseIproute2LinkScopeIPv4RouteCIDRs(routeJSON []byte) ([]string, error) {
	var routes []struct {
		Destination *string `json:"dst"`
	}
	if err := json.Unmarshal(routeJSON, &routes); err != nil {
		return nil, fmt.Errorf("failed to parse transparent proxy local destination routes from iproute2 JSON: %w", err)
	}
	cidrs := make([]string, 0, len(routes))
	for _, route := range routes {
		if route.Destination == nil || *route.Destination == "default" {
			continue
		}
		cidr, err := normalizeIPv4RouteDestination(*route.Destination)
		if err != nil {
			return nil, err
		}
		cidrs = append(cidrs, cidr)
	}
	sort.Strings(cidrs)
	return dedupeStrings(cidrs), nil
}

func excludedIPv4CIDRs(exclusions []protocol.TransparentProxyExclusion) ([]string, error) {
	cidrs := make([]string, 0, len(exclusions))
	for _, exclusion := range exclusions {
		switch exclusion.Kind {
		case protocol.TransparentProxyExclusionCIDR:
			cidr, err := normalizeIPv4CIDR(exclusion.Value)
			if err != nil {
				return nil, err
			}
			if cidr != "" {
				cidrs = append(cidrs, cidr)
			}
		case protocol.TransparentProxyExclusionHost:
			hostCIDRs, err := resolveHostExclusionIPv4CIDRs(exclusion.Value)
			if err != nil {
				return nil, err
			}
			cidrs = append(cidrs, hostCIDRs...)
		default:
			return nil, fmt.Errorf("unsupported transparent proxy exclusion kind %q", exclusion.Kind)
		}
	}
	sort.Strings(cidrs)
	return dedupeStrings(cidrs), nil
}

func normalizeIPv4RouteDestination(value string) (string, error) {
	if strings.Contains(value, "/") {
		cidr, err := normalizeIPv4CIDR(value)
		if err != nil {
			return "", err
		}
		if cidr == "" {
			return "", fmt.Errorf("transparent proxy local destination route %q is not IPv4", value)
		}
		return cidr, nil
	}
	address, err := netip.ParseAddr(value)
	if err != nil {
		return "", fmt.Errorf("transparent proxy local destination route %q has invalid IP address: %w", value, err)
	}
	if !address.Is4() {
		return "", fmt.Errorf("transparent proxy local destination route %q is not IPv4", value)
	}
	return address.String() + "/32", nil
}

func normalizeIPv4CIDR(value string) (string, error) {
	prefix, err := netip.ParsePrefix(value)
	if err != nil {
		return "", fmt.Errorf("transparent proxy CIDR exclusion %q is invalid: %w", value, err)
	}
	if !prefix.Addr().Is4() {
		return "", nil
	}
	return prefix.Masked().String(), nil
}

func canonicalizeIPv4IntervalSetCIDRs(cidrs []string) ([]string, error) {
	prefixes := make([]netip.Prefix, 0, len(cidrs))
	for _, cidr := range cidrs {
		prefix, err := parseIPv4CIDRForIntervalSet(cidr)
		if err != nil {
			return nil, err
		}
		prefixes = append(prefixes, prefix)
	}
	sort.Slice(prefixes, func(leftIndex int, rightIndex int) bool {
		left := prefixes[leftIndex]
		right := prefixes[rightIndex]
		if compare := left.Addr().Compare(right.Addr()); compare != 0 {
			return compare < 0
		}
		return left.Bits() < right.Bits()
	})

	canonicalPrefixes := make([]netip.Prefix, 0, len(prefixes))
	for _, prefix := range prefixes {
		if len(canonicalPrefixes) > 0 && canonicalPrefixes[len(canonicalPrefixes)-1] == prefix {
			continue
		}
		covered := false
		for _, existingPrefix := range canonicalPrefixes {
			if existingPrefix.Bits() <= prefix.Bits() && existingPrefix.Contains(prefix.Addr()) {
				covered = true
				break
			}
		}
		if !covered {
			canonicalPrefixes = append(canonicalPrefixes, prefix)
		}
	}

	result := make([]string, 0, len(canonicalPrefixes))
	for _, prefix := range canonicalPrefixes {
		result = append(result, prefix.String())
	}
	return result, nil
}

func parseIPv4CIDRForIntervalSet(value string) (netip.Prefix, error) {
	prefix, err := netip.ParsePrefix(value)
	if err != nil {
		return netip.Prefix{}, fmt.Errorf("transparent proxy IPv4 interval set CIDR %q is invalid: %w", value, err)
	}
	if !prefix.Addr().Is4() {
		return netip.Prefix{}, fmt.Errorf("transparent proxy IPv4 interval set CIDR %q is not IPv4", value)
	}
	return prefix.Masked(), nil
}

func resolveHostExclusionIPv4CIDRs(host string) ([]string, error) {
	addresses, err := net.LookupIP(host)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve transparent proxy host exclusion %q: %w", host, err)
	}
	cidrs := make([]string, 0, len(addresses))
	for _, address := range addresses {
		ipv4Address := address.To4()
		if ipv4Address != nil {
			cidrs = append(cidrs, net.IP(ipv4Address).String()+"/32")
		}
	}
	sort.Strings(cidrs)
	cidrs = dedupeStrings(cidrs)
	if len(cidrs) == 0 {
		return nil, fmt.Errorf("transparent proxy host exclusion %q did not resolve to an IPv4 address", host)
	}
	return cidrs, nil
}

func buildNftablesLocalDestinationSetAddCommand(tableName string, cidrs []string) []string {
	command := []string{"add", "element", "ip", tableName, localDestinationSetName, "{"}
	for index, cidr := range cidrs {
		if index > 0 {
			command = append(command, ",")
		}
		command = append(command, cidr)
	}
	return append(command, "}")
}

func removeCIDRs(cidrs []string, removedCIDRs []string) []string {
	removed := make(map[string]struct{}, len(removedCIDRs))
	for _, cidr := range removedCIDRs {
		removed[cidr] = struct{}{}
	}
	result := make([]string, 0, len(cidrs))
	for _, cidr := range cidrs {
		if _, ok := removed[cidr]; !ok {
			result = append(result, cidr)
		}
	}
	return result
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	deduped := values[:0]
	var previous string
	for index, value := range values {
		if index == 0 || value != previous {
			deduped = append(deduped, value)
		}
		previous = value
	}
	return deduped
}
