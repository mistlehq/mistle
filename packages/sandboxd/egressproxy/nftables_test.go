package egressproxy

import (
	"slices"
	"testing"

	"github.com/mistle/sandboxd/protocol"
)

func TestBypassesNATRewrittenBridgeDestinationsBeforeRedirect(t *testing.T) {
	configuration := transparentProxyConfiguration([]protocol.TransparentProxyExclusion{
		{
			Kind:   protocol.TransparentProxyExclusionCIDR,
			Value:  "169.254.0.0/16",
			Reason: "provider metadata traffic must stay direct",
		},
		{
			Kind:   protocol.TransparentProxyExclusionCIDR,
			Value:  "192.0.2.0/24",
			Reason: "provider control traffic must stay direct",
		},
	})

	plan, err := BuildNftablesRulePlanWithLocalDestinations(configuration, 38514, []string{"172.17.0.0/16", "10.88.0.0/16"})
	requireNoError(t, err)
	commands := BuildNftablesInstallCommands(plan)

	assertEqual(t, plan.TableName, TransparentNftablesTableName)
	assertStringSlicesEqual(t, plan.LocalDestinationIPv4CIDRs, []string{"10.88.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "172.17.0.0/16"})
	requireCommand(t, commands, []string{"add", "element", "ip", TransparentNftablesTableName, "local_destinations", "{", "10.88.0.0/16", ",", "127.0.0.0/8", ",", "169.254.0.0/16", ",", "172.17.0.0/16", "}"})
	requireCommand(t, commands, []string{"add", "rule", "ip", TransparentNftablesTableName, "output", "ip", "daddr", "@local_destinations", "counter", "return"})
	requireCommand(t, commands, []string{"add", "rule", "ip", TransparentNftablesTableName, "output", "ip", "daddr", "192.0.2.0/24", "counter", "return"})
	rejectArgument(t, commands, "log")
	assertStringSlicesEqual(t, commands[len(commands)-1], []string{"add", "rule", "ip", TransparentNftablesTableName, "output", "tcp", "dport", "1-65535", "counter", "redirect", "to", ":38514"})
}

func TestDropsLocalDestinationCIDRsCoveredByBroaderIntervalSetEntries(t *testing.T) {
	configuration := transparentProxyConfiguration(nil)

	plan, err := BuildNftablesRulePlanWithLocalDestinations(configuration, 38514, []string{
		"127.0.0.1/32",
		"169.254.169.254/32",
		"172.18.0.1/16",
		"172.18.4.0/24",
	})
	requireNoError(t, err)

	assertStringSlicesEqual(t, plan.LocalDestinationIPv4CIDRs, []string{"127.0.0.0/8", "169.254.0.0/16", "172.18.0.0/16"})
}

func TestInstallsLocalDestinationBypassesAsIntervalSetBeforeRedirect(t *testing.T) {
	configuration := transparentProxyConfiguration([]protocol.TransparentProxyExclusion{
		{
			Kind:   protocol.TransparentProxyExclusionCIDR,
			Value:  "192.0.2.0/24",
			Reason: "provider control traffic must stay direct",
		},
	})

	plan, err := BuildNftablesRulePlanWithLocalDestinations(configuration, 38514, []string{"172.18.0.0/16", "172.19.0.0/16"})
	requireNoError(t, err)
	commands := BuildNftablesInstallCommands(plan)

	requireCommand(t, commands, []string{"add", "set", "ip", TransparentNftablesTableName, "local_destinations", "{", "type", "ipv4_addr", ";", "flags", "interval", ";", "}"})
	requireCommand(t, commands, []string{"add", "element", "ip", TransparentNftablesTableName, "local_destinations", "{", "127.0.0.0/8", ",", "169.254.0.0/16", ",", "172.18.0.0/16", ",", "172.19.0.0/16", "}"})
	requireCommand(t, commands, []string{"add", "rule", "ip", TransparentNftablesTableName, "output", "ip", "daddr", "@local_destinations", "counter", "return"})
	rejectArgument(t, commands, "log")
}

func TestBuildsLocalDestinationSetReplacementForReconciliation(t *testing.T) {
	script := BuildNftablesLocalDestinationSetReplaceScript(TransparentNftablesTableName, []string{
		"127.0.0.0/8",
		"169.254.0.0/16",
		"172.18.0.0/16",
	})

	assertEqual(t, script, "flush set ip mistle_transparent_egress local_destinations\nadd element ip mistle_transparent_egress local_destinations { 127.0.0.0/8 , 169.254.0.0/16 , 172.18.0.0/16 }\n")
}

func TestParsesLinkScopeIPv4RoutesAsLocalDestinationCIDRs(t *testing.T) {
	cidrs, err := ParseIproute2LinkScopeIPv4RouteCIDRs([]byte(`[
		{"dst":"172.17.0.0/16","dev":"docker0","protocol":"kernel","scope":"link","prefsrc":"172.17.0.1"},
		{"dst":"10.88.0.0/16","dev":"podman0","protocol":"kernel","scope":"link","prefsrc":"10.88.0.1"},
		{"dst":"192.0.2.12","dev":"veth0","protocol":"kernel","scope":"link","prefsrc":"192.0.2.12"}
	]`))
	requireNoError(t, err)

	assertStringSlicesEqual(t, cidrs, []string{"10.88.0.0/16", "172.17.0.0/16", "192.0.2.12/32"})
}

func TestNftablesPlanRequiresSocketMarkBypass(t *testing.T) {
	configuration := transparentProxyConfiguration(nil)
	configuration.PassthroughBypass.Kind = "unsupported"

	_, err := BuildNftablesRulePlanWithLocalDestinations(configuration, 38514, nil)
	if err == nil {
		t.Fatalf("expected unsupported bypass kind to fail")
	}
	assertEqual(t, err.Error(), "transparent proxy packet rules require socket-mark passthrough bypass")
}

func TestNftablesPlanRequiresNonZeroSocketMark(t *testing.T) {
	configuration := transparentProxyConfiguration(nil)
	configuration.PassthroughBypass.Mark = 0

	_, err := BuildNftablesRulePlanWithLocalDestinations(configuration, 38514, nil)
	if err == nil {
		t.Fatalf("expected zero socket mark to fail")
	}
	assertEqual(t, err.Error(), "transparent proxy socket-mark bypass value must be non-zero")
}

func transparentProxyConfiguration(exclusions []protocol.TransparentProxyExclusion) protocol.TransparentProxyConfiguration {
	return protocol.TransparentProxyConfiguration{
		PassthroughBypass: protocol.TransparentProxyBypass{
			Kind: protocol.TransparentProxyBypassSocketMark,
			Mark: 38514,
		},
		Exclusions: exclusions,
	}
}

func requireCommand(t *testing.T, commands [][]string, expected []string) {
	t.Helper()
	for _, command := range commands {
		if slices.Equal(command, expected) {
			return
		}
	}
	t.Fatalf("expected commands to contain %#v, got %#v", expected, commands)
}

func rejectArgument(t *testing.T, commands [][]string, rejected string) {
	t.Helper()
	for _, command := range commands {
		for _, argument := range command {
			if argument == rejected {
				t.Fatalf("expected argument %q to be absent from %#v", rejected, commands)
			}
		}
	}
}

func assertStringSlicesEqual(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if !slices.Equal(actual, expected) {
		t.Fatalf("expected %#v, got %#v", expected, actual)
	}
}
