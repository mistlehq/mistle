package piproxy

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/cgroups"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/supervision"
)

const DefaultPiProxyListenURL = "ws://127.0.0.1:4520"

type Config struct {
	PiCLIPath string
	Env       map[string]string
}

type PlatformScope struct {
	RegistryKey string
	ProcessKey  string
	ScopePaths  cgroups.ScopePaths
	Registry    *process.PlatformProcessRegistry
}

type Proxy struct {
	listenURL        string
	server           *http.Server
	done             chan struct{}
	monitorStop      chan struct{}
	monitorDone      chan struct{}
	once             sync.Once
	state            *State
	supervisorHandle *supervision.SandboxdSupervisorHandle
}

func StartPiProxy(
	listenURL string,
	config Config,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
) (*Proxy, error) {
	return startPiProxy(listenURL, config, keepaliveManager, supervisorHandle, nil, nil)
}

func StartPiProxyWithIdempotencyStore(
	listenURL string,
	config Config,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	store *idempotency.Store,
) (*Proxy, error) {
	if store == nil {
		return nil, fmt.Errorf("Pi idempotency store is required")
	}
	return startPiProxy(listenURL, config, keepaliveManager, supervisorHandle, NewSharedIdempotencyStore(store), nil)
}

func StartPiProxyWithIdempotencyStoreAndPlatformScope(
	listenURL string,
	config Config,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	store *idempotency.Store,
	platformScope PlatformScope,
) (*Proxy, error) {
	if store == nil {
		return nil, fmt.Errorf("Pi idempotency store is required")
	}
	if platformScope.Registry == nil {
		return nil, fmt.Errorf("Pi platform scope registry is required")
	}
	if platformScope.RegistryKey == "" {
		return nil, fmt.Errorf("Pi platform scope registry key is required")
	}
	if platformScope.ProcessKey == "" {
		return nil, fmt.Errorf("Pi platform scope process key is required")
	}
	return startPiProxy(listenURL, config, keepaliveManager, supervisorHandle, NewSharedIdempotencyStore(store), &platformScope)
}

func startPiProxy(
	listenURL string,
	config Config,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	idempotencyStore *SharedIdempotencyStore,
	platformScope *PlatformScope,
) (*Proxy, error) {
	if strings.TrimSpace(config.PiCLIPath) == "" {
		return nil, fmt.Errorf("Pi runtime client setup must define MISTLE_PI_CLI_PATH")
	}
	listenAddress, err := listenAddressFromWebSocketURL(listenURL)
	if err != nil {
		return nil, err
	}
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		supervisorHandle.MarkComponentRestarting(supervision.ComponentPiProxy, err.Error())
		return nil, fmt.Errorf("failed to start Pi proxy listener: %w", err)
	}
	resolvedListenURL, err := resolvedWebSocketURL(listenURL, listener.Addr())
	if err != nil {
		if closeErr := listener.Close(); closeErr != nil {
			return nil, fmt.Errorf("failed to close Pi proxy listener after URL resolution failure: %w", closeErr)
		}
		supervisorHandle.MarkComponentRestarting(supervision.ComponentPiProxy, err.Error())
		return nil, err
	}
	supervisorHandle.ReplaceComponentDetails(supervision.ComponentPiProxy, map[string]string{
		"listenAddr": resolvedListenURL,
	})
	supervisorHandle.MarkComponentStarting(supervision.ComponentPiProxy)

	state := NewState(config, keepaliveManager, supervisorHandle, idempotencyStore, platformScope)
	if err := state.EnsureChild(nil); err != nil {
		_ = listener.Close()
		return nil, err
	}
	proxy := &Proxy{
		listenURL:        resolvedListenURL,
		server:           &http.Server{},
		done:             make(chan struct{}),
		monitorStop:      make(chan struct{}),
		monitorDone:      make(chan struct{}),
		state:            state,
		supervisorHandle: supervisorHandle,
	}
	go func() {
		defer close(proxy.monitorDone)
		state.StartChildMonitor(proxy.monitorStop)
	}()
	proxy.server.Handler = proxy
	go func() {
		defer close(proxy.done)
		if err := proxy.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			supervisorHandle.MarkComponentRestarting(supervision.ComponentPiProxy, err.Error())
		}
	}()

	supervisorHandle.MarkComponentHealthy(supervision.ComponentPiProxy)
	supervisorHandle.RecordComponentHealthcheck(supervision.ComponentPiProxy)
	return proxy, nil
}

func (proxy *Proxy) ListenURL() string {
	return proxy.listenURL
}

func (proxy *Proxy) Close() error {
	var closeErr error
	proxy.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		closeErr = proxy.server.Shutdown(ctx)
		close(proxy.monitorStop)
		<-proxy.monitorDone
		if shutdownErr := proxy.state.ShutdownChild(); closeErr == nil {
			closeErr = shutdownErr
		}
		<-proxy.done
		proxy.supervisorHandle.MarkComponentStopped(supervision.ComponentPiProxy)
	})
	return closeErr
}

func (proxy *Proxy) ServeHTTP(responseWriter http.ResponseWriter, request *http.Request) {
	connection, err := websocket.Accept(responseWriter, request, nil)
	if err != nil {
		return
	}
	defer connection.CloseNow()
	eventReceiver := proxy.state.SubscribeEvents()
	for {
		if err := proxy.flushQueuedEvents(request.Context(), connection, eventReceiver); err != nil {
			return
		}
		readContext, cancel := context.WithTimeout(request.Context(), 100*time.Millisecond)
		_, payload, err := connection.Read(readContext)
		cancel()
		if err != nil {
			if request.Context().Err() != nil {
				return
			}
			if closeStatus := websocket.CloseStatus(err); closeStatus != -1 {
				return
			}
			if strings.Contains(err.Error(), "context deadline exceeded") {
				continue
			}
			return
		}
		for _, response := range HandleJSONRPCRequest(proxy.state, payload) {
			if err := connection.Write(request.Context(), websocket.MessageText, response); err != nil {
				return
			}
		}
	}
}

func (proxy *Proxy) flushQueuedEvents(ctx context.Context, connection *websocket.Conn, eventReceiver <-chan []byte) error {
	for {
		select {
		case event, ok := <-eventReceiver:
			if !ok {
				return nil
			}
			if err := connection.Write(ctx, websocket.MessageText, event); err != nil {
				return err
			}
		default:
			return nil
		}
	}
}

func listenAddressFromWebSocketURL(rawURL string) (string, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse Pi proxy listen URL: %w", err)
	}
	if parsedURL.Scheme != "ws" {
		return "", fmt.Errorf("Pi proxy listen URL must use ws scheme: %s", rawURL)
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("Pi proxy listen URL must include a host: %s", rawURL)
	}
	return parsedURL.Host, nil
}

func resolvedWebSocketURL(rawURL string, address net.Addr) (string, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse Pi proxy listen URL: %w", err)
	}
	tcpAddress, ok := address.(*net.TCPAddr)
	if !ok {
		return "", fmt.Errorf("Pi proxy listener address was not TCP: %s", address.String())
	}
	host := parsedURL.Hostname()
	if host == "" {
		return "", fmt.Errorf("Pi proxy listen URL must include a host: %s", rawURL)
	}
	parsedURL.Host = net.JoinHostPort(host, fmt.Sprint(tcpAddress.Port))
	return parsedURL.String(), nil
}

func commandEnvironment(env map[string]string) []string {
	result := os.Environ()
	for key, value := range env {
		result = append(result, key+"="+value)
	}
	return result
}

func terminateCommand(command *exec.Cmd, done <-chan error) {
	if command.Process == nil {
		return
	}
	_ = command.Process.Kill()
	<-done
}
