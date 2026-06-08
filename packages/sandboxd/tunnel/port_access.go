package tunnel

import (
	"crypto/tls"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	defaultPortAccessProbeTimeout = 2 * time.Second
	probeResponseBufferBytes      = 1024
)

type PortAccessAuthorizeDecision struct {
	Authorized       bool
	UpstreamProtocol string
	WebsocketCapable bool
	RejectionReason  string
}

func AuthorizeTargetPort(clock timeutil.Clock, target tunnelprotocol.PortAccessTarget) (PortAccessAuthorizeDecision, error) {
	bindAddresses, err := bindAddressesForSnapshotPort(clock, target.Port)
	if err != nil {
		return PortAccessAuthorizeDecision{}, err
	}
	if len(bindAddresses) == 0 {
		return PortAccessAuthorizeDecision{
			Authorized:      false,
			RejectionReason: tunnelprotocol.PortAccessAuthorizeReasonPortUnreachable,
		}, nil
	}

	probeOutcomes := make([]portProbeOutcome, 0, len(bindAddresses)*2)
	for _, bindAddress := range bindAddresses {
		outcome := probeHTTP(bindAddress, target.Port)
		if outcome.supported {
			return PortAccessAuthorizeDecision{
				Authorized:       true,
				UpstreamProtocol: outcome.upstreamProtocol,
				WebsocketCapable: outcome.websocketCapable,
			}, nil
		}
		probeOutcomes = append(probeOutcomes, outcome)
	}
	for _, bindAddress := range bindAddresses {
		outcome := probeHTTPS(bindAddress, target.Port)
		if outcome.supported {
			return PortAccessAuthorizeDecision{
				Authorized:       true,
				UpstreamProtocol: outcome.upstreamProtocol,
				WebsocketCapable: outcome.websocketCapable,
			}, nil
		}
		probeOutcomes = append(probeOutcomes, outcome)
	}
	for _, outcome := range probeOutcomes {
		if !outcome.portUnreachable {
			return PortAccessAuthorizeDecision{
				Authorized:      false,
				RejectionReason: tunnelprotocol.PortAccessAuthorizeReasonUnsupportedProtocol,
			}, nil
		}
	}
	return PortAccessAuthorizeDecision{
		Authorized:      false,
		RejectionReason: tunnelprotocol.PortAccessAuthorizeReasonPortUnreachable,
	}, nil
}

type portProbeOutcome struct {
	supported        bool
	portUnreachable  bool
	upstreamProtocol string
	websocketCapable bool
}

func bindAddressesForSnapshotPort(clock timeutil.Clock, port uint16) ([]string, error) {
	snapshot, err := CollectProcessesSnapshot(clock)
	if err != nil {
		return nil, err
	}
	bindAddresses := make([]string, 0)
	seen := map[string]struct{}{}
	for _, process := range snapshot.Processes {
		for _, listener := range process.Listeners {
			if listener.Port != port {
				continue
			}
			if _, exists := seen[listener.BindAddress]; exists {
				continue
			}
			seen[listener.BindAddress] = struct{}{}
			bindAddresses = append(bindAddresses, listener.BindAddress)
		}
	}
	return bindAddresses, nil
}

func probeHTTP(bindAddress string, port uint16) portProbeOutcome {
	connection, err := connectLoopback(bindAddress, port)
	if err != nil {
		return portProbeOutcome{portUnreachable: true}
	}
	defer connection.Close()
	if !probeHTTPLikeResponse(connection, bindAddress, port) {
		return portProbeOutcome{}
	}
	return portProbeOutcome{
		supported:        true,
		upstreamProtocol: "http",
		websocketCapable: probeWebsocketHTTP(bindAddress, port),
	}
}

func probeHTTPS(bindAddress string, port uint16) portProbeOutcome {
	rawConnection, err := connectLoopback(bindAddress, port)
	if err != nil {
		return portProbeOutcome{portUnreachable: true}
	}
	defer rawConnection.Close()
	connection := tls.Client(rawConnection, &tls.Config{
		ServerName:         "localhost",
		InsecureSkipVerify: true,
	})
	if err := connection.SetDeadline(time.Now().Add(defaultPortAccessProbeTimeout)); err != nil {
		return portProbeOutcome{}
	}
	if err := connection.Handshake(); err != nil {
		return portProbeOutcome{}
	}
	if !probeHTTPLikeResponse(connection, bindAddress, port) {
		return portProbeOutcome{}
	}
	return portProbeOutcome{
		supported:        true,
		upstreamProtocol: "https",
		websocketCapable: probeWebsocketHTTPS(bindAddress, port),
	}
}

func connectLoopback(bindAddress string, port uint16) (net.Conn, error) {
	dialer := net.Dialer{Timeout: defaultPortAccessProbeTimeout}
	return dialer.Dial("tcp", net.JoinHostPort(bindAddress, fmt.Sprintf("%d", port)))
}

func probeHTTPLikeResponse(connection net.Conn, bindAddress string, port uint16) bool {
	request := fmt.Sprintf(
		"GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n",
		loopbackHostHeader(bindAddress, port),
	)
	if err := connection.SetDeadline(time.Now().Add(defaultPortAccessProbeTimeout)); err != nil {
		return false
	}
	if _, err := connection.Write([]byte(request)); err != nil {
		return false
	}
	response := make([]byte, probeResponseBufferBytes)
	bytesRead, err := connection.Read(response)
	if err != nil || bytesRead == 0 {
		return false
	}
	return strings.HasPrefix(string(response[:bytesRead]), "HTTP/1.")
}

func probeWebsocketHTTP(bindAddress string, port uint16) bool {
	connection, err := connectLoopback(bindAddress, port)
	if err != nil {
		return false
	}
	defer connection.Close()
	return probeWebsocketUpgradeResponse(connection, bindAddress, port)
}

func probeWebsocketHTTPS(bindAddress string, port uint16) bool {
	rawConnection, err := connectLoopback(bindAddress, port)
	if err != nil {
		return false
	}
	defer rawConnection.Close()
	connection := tls.Client(rawConnection, &tls.Config{
		ServerName:         "localhost",
		InsecureSkipVerify: true,
	})
	if err := connection.SetDeadline(time.Now().Add(defaultPortAccessProbeTimeout)); err != nil {
		return false
	}
	if err := connection.Handshake(); err != nil {
		return false
	}
	return probeWebsocketUpgradeResponse(connection, bindAddress, port)
}

func probeWebsocketUpgradeResponse(connection net.Conn, bindAddress string, port uint16) bool {
	request := fmt.Sprintf(
		"GET / HTTP/1.1\r\nHost: %s\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
		loopbackHostHeader(bindAddress, port),
	)
	if err := connection.SetDeadline(time.Now().Add(defaultPortAccessProbeTimeout)); err != nil {
		return false
	}
	if _, err := connection.Write([]byte(request)); err != nil {
		return false
	}
	response := make([]byte, probeResponseBufferBytes)
	bytesRead, err := connection.Read(response)
	if err != nil || bytesRead == 0 {
		return false
	}
	prefix := string(response[:bytesRead])
	return strings.HasPrefix(prefix, "HTTP/1.1 101") || strings.HasPrefix(prefix, "HTTP/1.0 101")
}

func loopbackHostHeader(bindAddress string, port uint16) string {
	if strings.Contains(bindAddress, ":") {
		return fmt.Sprintf("[%s]:%d", bindAddress, port)
	}
	return fmt.Sprintf("%s:%d", bindAddress, port)
}
