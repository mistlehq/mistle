package egressproxy

import (
	"bytes"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestReconcilesTransparentLocalDestinationsWithDiagnosticsOnSuccess(t *testing.T) {
	var nftScript string
	cidrs, err := reconcileTransparentLocalDestinationsWith(
		TransparentNftablesTableName,
		func() ([]string, error) {
			return []string{"172.18.0.0/16"}, nil
		},
		func(script string) error {
			nftScript = script
			return nil
		},
	)
	requireNoError(t, err)

	assertStringSlicesEqual(t, cidrs, []string{"127.0.0.0/8", "169.254.0.0/16", "172.18.0.0/16"})
	if !strings.Contains(nftScript, "flush set ip mistle_transparent_egress local_destinations") {
		t.Fatalf("expected nft script to replace local destination set, got %q", nftScript)
	}
}

func TestRecordsTransparentLocalDestinationReconcileFailureDiagnostics(t *testing.T) {
	var output bytes.Buffer
	previousOutput := transparentProxyDiagnosticsOutput
	transparentProxyDiagnosticsOutput = &output
	t.Cleanup(func() {
		transparentProxyDiagnosticsOutput = previousOutput
	})

	_, err := reconcileTransparentLocalDestinationsWith(
		TransparentNftablesTableName,
		func() ([]string, error) {
			return nil, errors.New("ip route failed")
		},
		func(string) error {
			t.Fatalf("nft script should not run after discovery failure")
			return nil
		},
	)
	if err == nil {
		t.Fatalf("expected reconcile failure")
	}
	emitTransparentProxyDiagnostic("egress_proxy_local_destination_reconcile_failed", map[string]any{
		"tableName": TransparentNftablesTableName,
		"trigger":   "test",
		"error":     err.Error(),
	})

	logLine := output.String()
	if !strings.Contains(logLine, `"event":"egress_proxy_local_destination_reconcile_failed"`) ||
		!strings.Contains(logLine, `"error":"ip route failed"`) ||
		!strings.Contains(logLine, `"tableName":"mistle_transparent_egress"`) {
		t.Fatalf("expected structured reconcile failure diagnostic, got %q", logLine)
	}
}

func TestTransparentLocalDestinationReconcilerReconcilesOnRouteMonitorEventsLikeRust(t *testing.T) {
	var output bytes.Buffer
	previousOutput := transparentProxyDiagnosticsOutput
	previousDiscover := discoverTransparentLocalDestinationIPv4CIDRs
	previousRunNftScript := runTransparentNftScript
	transparentProxyDiagnosticsOutput = &output
	discoverCount := 0
	discoverTransparentLocalDestinationIPv4CIDRs = func() ([]string, error) {
		discoverCount++
		if discoverCount == 1 {
			return []string{"172.18.0.0/16"}, nil
		}
		return []string{"172.19.0.0/16"}, nil
	}
	scriptRuns := make(chan string, 2)
	runTransparentNftScript = func(script string) error {
		scriptRuns <- script
		return nil
	}
	t.Cleanup(func() {
		transparentProxyDiagnosticsOutput = previousOutput
		discoverTransparentLocalDestinationIPv4CIDRs = previousDiscover
		runTransparentNftScript = previousRunNftScript
	})
	monitor := newChannelTransparentRouteEventMonitor()
	reconciler, err := startTransparentLocalDestinationReconcilerWithMonitor(
		TransparentNftablesTableName,
		time.Hour,
		func() (transparentRouteEventMonitor, error) {
			return monitor, nil
		},
	)
	requireNoError(t, err)
	defer reconciler.Close()
	requireScriptRun(t, scriptRuns, "startup reconciliation should run")

	monitor.Send()
	requireScriptRun(t, scriptRuns, "rtnetlink event should trigger reconciliation")

	logs := output.String()
	if !strings.Contains(logs, `"event":"egress_proxy_local_destination_reconcile_completed"`) ||
		!strings.Contains(logs, `"trigger":"rtnetlink_event"`) ||
		!strings.Contains(logs, `"cidrs":["127.0.0.0/8","169.254.0.0/16","172.19.0.0/16"]`) ||
		!strings.Contains(logs, `"addedCidrs":["172.19.0.0/16"]`) ||
		!strings.Contains(logs, `"removedCidrs":["172.18.0.0/16"]`) {
		t.Fatalf("expected Rust-compatible route event reconciliation logs, got %q", logs)
	}
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

type channelTransparentRouteEventMonitor struct {
	events chan struct{}
	once   sync.Once
}

func newChannelTransparentRouteEventMonitor() *channelTransparentRouteEventMonitor {
	return &channelTransparentRouteEventMonitor{events: make(chan struct{}, 4)}
}

func (monitor *channelTransparentRouteEventMonitor) Close() {
	monitor.once.Do(func() {
		close(monitor.events)
	})
}

func (monitor *channelTransparentRouteEventMonitor) Events() <-chan struct{} {
	return monitor.events
}

func (monitor *channelTransparentRouteEventMonitor) Send() {
	monitor.events <- struct{}{}
}

func requireScriptRun(t *testing.T, scriptRuns <-chan string, description string) {
	t.Helper()
	select {
	case <-scriptRuns:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}
