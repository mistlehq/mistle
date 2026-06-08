package opencodeproxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/supervision"
)

const ActivityMonitorReconnectInterval = 100 * time.Millisecond

type Proxy struct {
	listenURL        string
	rawServerURL     string
	server           *http.Server
	activityContext  context.Context
	activityCancel   context.CancelFunc
	activityStop     chan struct{}
	activityDone     chan struct{}
	done             chan struct{}
	once             sync.Once
	supervisorHandle *supervision.SandboxdSupervisorHandle
	keepaliveManager *keepalive.SharedManager
	idempotencyStore *SharedIdempotencyStore
}

type Request struct {
	ID          any               `json:"id"`
	Method      string            `json:"method"`
	Path        string            `json:"path"`
	Headers     map[string]string `json:"headers"`
	Body        any               `json:"body"`
	Idempotency json.RawMessage   `json:"idempotency"`
}

type Response struct {
	ID      any               `json:"id"`
	Type    string            `json:"type"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	Event   *string           `json:"event,omitempty"`
	Data    *string           `json:"data,omitempty"`
}

func StartOpenCodeProxy(
	listenURL string,
	rawServerURL string,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
) (*Proxy, error) {
	return startOpenCodeProxy(listenURL, rawServerURL, keepaliveManager, supervisorHandle, nil)
}

func StartOpenCodeProxyWithIdempotencyStore(
	listenURL string,
	rawServerURL string,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	store *idempotency.Store,
) (*Proxy, error) {
	if store == nil {
		return nil, fmt.Errorf("OpenCode idempotency store is required")
	}
	return startOpenCodeProxy(listenURL, rawServerURL, keepaliveManager, supervisorHandle, NewSharedIdempotencyStore(store))
}

func startOpenCodeProxy(
	listenURL string,
	rawServerURL string,
	keepaliveManager *keepalive.SharedManager,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	idempotencyStore *SharedIdempotencyStore,
) (*Proxy, error) {
	listenAddress, err := listenAddressFromWebSocketURL(listenURL, "OpenCode")
	if err != nil {
		return nil, err
	}
	if err := validateRawServerURL(rawServerURL); err != nil {
		return nil, err
	}

	supervisorHandle.ReplaceComponentDetails(supervision.ComponentOpenCodeProxy, map[string]string{
		"listenAddr": listenURL,
		"rawTarget":  rawServerURL,
	})
	supervisorHandle.MarkComponentStarting(supervision.ComponentOpenCodeProxy)

	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		supervisorHandle.MarkComponentRestarting(supervision.ComponentOpenCodeProxy, err.Error())
		return nil, fmt.Errorf("failed to start OpenCode proxy listener: %w", err)
	}
	resolvedListenURL, err := resolvedWebSocketURL(listenURL, listener.Addr())
	if err != nil {
		if closeErr := listener.Close(); closeErr != nil {
			return nil, fmt.Errorf("failed to close OpenCode proxy listener after URL resolution failure: %w", closeErr)
		}
		supervisorHandle.MarkComponentRestarting(supervision.ComponentOpenCodeProxy, err.Error())
		return nil, err
	}
	supervisorHandle.ReplaceComponentDetails(supervision.ComponentOpenCodeProxy, map[string]string{
		"listenAddr": resolvedListenURL,
		"rawTarget":  rawServerURL,
	})

	activityContext, activityCancel := context.WithCancel(context.Background())
	proxy := &Proxy{
		listenURL:        resolvedListenURL,
		rawServerURL:     strings.TrimRight(rawServerURL, "/"),
		activityContext:  activityContext,
		activityCancel:   activityCancel,
		activityStop:     make(chan struct{}),
		activityDone:     make(chan struct{}),
		done:             make(chan struct{}),
		supervisorHandle: supervisorHandle,
		keepaliveManager: keepaliveManager,
		idempotencyStore: idempotencyStore,
	}
	proxy.server = &http.Server{Handler: proxy}

	go func() {
		defer close(proxy.done)
		if err := proxy.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			supervisorHandle.MarkComponentRestarting(supervision.ComponentOpenCodeProxy, err.Error())
		}
	}()
	go proxy.runActivityMonitor()

	supervisorHandle.MarkComponentHealthy(supervision.ComponentOpenCodeProxy)
	supervisorHandle.RecordComponentHealthcheck(supervision.ComponentOpenCodeProxy)
	return proxy, nil
}

func (proxy *Proxy) ListenURL() string {
	return proxy.listenURL
}

func (proxy *Proxy) Close() error {
	var closeErr error
	proxy.once.Do(func() {
		proxy.activityCancel()
		close(proxy.activityStop)
		<-proxy.activityDone
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		closeErr = proxy.server.Shutdown(ctx)
		<-proxy.done
		proxy.supervisorHandle.MarkComponentStopped(supervision.ComponentOpenCodeProxy)
	})
	return closeErr
}

func (proxy *Proxy) ServeHTTP(responseWriter http.ResponseWriter, request *http.Request) {
	connection, err := websocket.Accept(responseWriter, request, nil)
	if err != nil {
		return
	}
	sessionContext, cancelSession := context.WithCancel(request.Context())
	writer := &openCodeProxyConnectionWriter{connection: connection}
	var requestTasks sync.WaitGroup
	defer func() {
		cancelSession()
		requestTasks.Wait()
		connection.CloseNow()
	}()

	for {
		_, payload, err := connection.Read(sessionContext)
		if err != nil {
			return
		}
		var proxyRequest Request
		decoder := json.NewDecoder(bytes.NewReader(payload))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&proxyRequest); err != nil {
			return
		}
		requestTasks.Add(1)
		go func(proxyRequest Request) {
			defer requestTasks.Done()
			if err := proxy.handleRequest(sessionContext, writer, proxyRequest); err != nil {
				_ = writer.WriteResponse(sessionContext, Response{
					ID:      proxyRequest.ID,
					Type:    "response",
					Status:  502,
					Headers: map[string]string{"content-type": "application/json"},
					Body:    fmt.Sprintf(`{"error":%q}`, err.Error()),
				})
			}
		}(proxyRequest)
	}
}

type openCodeProxyConnectionWriter struct {
	connection *websocket.Conn
	mutex      sync.Mutex
}

func (writer *openCodeProxyConnectionWriter) WriteResponse(ctx context.Context, response Response) error {
	writer.mutex.Lock()
	defer writer.mutex.Unlock()
	return writeProxyResponse(ctx, writer.connection, response)
}

func (proxy *Proxy) handleRequest(ctx context.Context, writer *openCodeProxyConnectionWriter, proxyRequest Request) error {
	idempotencyAction := prepareIdempotency(&proxyRequest, proxy.idempotencyStore)
	switch idempotencyAction.kind {
	case idempotencyActionDisabled:
	case idempotencyActionForward:
	case idempotencyActionReplay:
		return writer.WriteResponse(ctx, Response{
			ID:      proxyRequest.ID,
			Type:    "response",
			Status:  idempotencyAction.replay.Status,
			Headers: idempotencyAction.replay.Headers,
			Body:    idempotencyAction.replay.Body,
		})
	case idempotencyActionReject:
		return writer.WriteResponse(ctx, Response{
			ID:      proxyRequest.ID,
			Type:    "response",
			Status:  idempotencyAction.status,
			Headers: map[string]string{"content-type": "application/json"},
			Body:    fmt.Sprintf(`{"error":%q}`, idempotencyAction.message),
		})
	default:
		return fmt.Errorf("unsupported OpenCode idempotency action %q", idempotencyAction.kind)
	}
	targetURL, err := buildTargetURL(proxy.rawServerURL, proxyRequest.Path)
	if err != nil {
		return err
	}
	body, err := requestBody(proxyRequest.Body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, proxyRequest.Method, targetURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to build OpenCode upstream request: %w", err)
	}
	for name, value := range proxyRequest.Headers {
		request.Header.Set(name, value)
	}
	if proxyRequest.Body != nil && request.Header.Get("content-type") == "" {
		request.Header.Set("content-type", "application/json")
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		if idempotencyAction.started != nil && proxy.idempotencyStore != nil {
			if deleteErr := deleteStartedIdempotency(proxy.idempotencyStore, *idempotencyAction.started); deleteErr != nil {
				return fmt.Errorf("OpenCode upstream request failed before a response, and the idempotency record could not be released for retry: %w", deleteErr)
			}
		}
		return fmt.Errorf("OpenCode upstream request failed: %w", err)
	}
	defer response.Body.Close()

	headers := responseHeaders(response.Header)
	if strings.HasPrefix(response.Header.Get("content-type"), "text/event-stream") {
		if idempotencyAction.started != nil && proxy.idempotencyStore != nil {
			storedResponse := StoredResponse{
				Status:  502,
				Headers: map[string]string{"content-type": "application/json"},
				Body:    `{"error":"OpenCode idempotent requests cannot replay text/event-stream responses."}`,
			}
			if err := completeIdempotency(proxy.idempotencyStore, *idempotencyAction.started, storedResponse); err != nil {
				return fmt.Errorf("OpenCode SSE response could not be persisted for idempotent replay: %w", err)
			}
			return writer.WriteResponse(ctx, Response{
				ID:      proxyRequest.ID,
				Type:    "response",
				Status:  storedResponse.Status,
				Headers: storedResponse.Headers,
				Body:    storedResponse.Body,
			})
		}
		if err := writer.WriteResponse(ctx, Response{
			ID:      proxyRequest.ID,
			Type:    "response",
			Status:  response.StatusCode,
			Headers: headers,
			Body:    "",
		}); err != nil {
			return err
		}
		return proxy.relaySSEResponse(ctx, writer, proxyRequest.ID, response.StatusCode, headers, response.Body)
	}

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		if idempotencyAction.started != nil && proxy.idempotencyStore != nil {
			if deleteErr := deleteStartedIdempotency(proxy.idempotencyStore, *idempotencyAction.started); deleteErr != nil {
				return fmt.Errorf("OpenCode upstream response body failed, and the idempotency record could not be released for retry: %w", deleteErr)
			}
		}
		return fmt.Errorf("failed to read OpenCode upstream response: %w", err)
	}
	if idempotencyAction.started != nil && proxy.idempotencyStore != nil {
		storedResponse := StoredResponse{
			Status:  response.StatusCode,
			Headers: headers,
			Body:    string(responseBody),
		}
		if err := completeIdempotency(proxy.idempotencyStore, *idempotencyAction.started, storedResponse); err != nil {
			return fmt.Errorf("OpenCode idempotency response could not be persisted: %w", err)
		}
	}
	return writer.WriteResponse(ctx, Response{
		ID:      proxyRequest.ID,
		Type:    "response",
		Status:  response.StatusCode,
		Headers: headers,
		Body:    string(responseBody),
	})
}

func (proxy *Proxy) relaySSEResponse(
	ctx context.Context,
	writer *openCodeProxyConnectionWriter,
	id any,
	status int,
	headers map[string]string,
	body io.Reader,
) error {
	scanner := bufio.NewScanner(body)
	var eventLines []string
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if len(eventLines) > 0 {
				if event := parseOpenCodeSSEEvent(strings.Join(eventLines, "\n")); event != nil {
					if err := writer.WriteResponse(ctx, Response{
						ID:      id,
						Type:    "sse",
						Status:  status,
						Headers: headers,
						Body:    strings.Join(eventLines, "\n") + "\n\n",
						Event:   event.Event,
						Data:    &event.Data,
					}); err != nil {
						return err
					}
				}
				eventLines = nil
			}
			continue
		}
		eventLines = append(eventLines, line)
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("failed to read OpenCode SSE response: %w", err)
	}
	if len(eventLines) > 0 {
		if event := parseOpenCodeSSEEvent(strings.Join(eventLines, "\n")); event != nil {
			if err := writer.WriteResponse(ctx, Response{
				ID:      id,
				Type:    "sse",
				Status:  status,
				Headers: headers,
				Body:    strings.Join(eventLines, "\n") + "\n\n",
				Event:   event.Event,
				Data:    &event.Data,
			}); err != nil {
				return err
			}
		}
	}
	return writer.WriteResponse(ctx, Response{
		ID:      id,
		Type:    "complete",
		Status:  status,
		Headers: headers,
		Body:    "",
	})
}

type parsedOpenCodeSSEEvent struct {
	Event *string
	Data  string
}

func parseOpenCodeSSEEvent(eventText string) *parsedOpenCodeSSEEvent {
	var eventName *string
	var dataLines []string
	for _, line := range strings.Split(eventText, "\n") {
		if value, ok := strings.CutPrefix(line, "event:"); ok {
			trimmedValue := strings.TrimLeft(value, " \t")
			eventName = &trimmedValue
		} else if value, ok := strings.CutPrefix(line, "data:"); ok {
			dataLines = append(dataLines, strings.TrimLeft(value, " \t"))
		}
	}
	if len(dataLines) == 0 {
		return nil
	}
	return &parsedOpenCodeSSEEvent{
		Event: eventName,
		Data:  strings.Join(dataLines, "\n"),
	}
}

func (proxy *Proxy) runActivityMonitor() {
	defer close(proxy.activityDone)
	activeSessions := map[string]struct{}{}
	for {
		select {
		case <-proxy.activityStop:
			proxy.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
				manager.SetPlatformActive(false)
			})
			return
		default:
		}

		if err := proxy.rebuildActivityFromStatus(proxy.activityContext, activeSessions); err == nil {
			proxy.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
				manager.SetPlatformActive(len(activeSessions) > 0)
			})
			_ = proxy.consumeActivityEvents(activeSessions)
		}

		proxy.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
			manager.SetPlatformActive(false)
		})
		clear(activeSessions)

		select {
		case <-proxy.activityStop:
			return
		case <-time.After(ActivityMonitorReconnectInterval):
		}
	}
}

func (proxy *Proxy) rebuildActivityFromStatus(ctx context.Context, activeSessions map[string]struct{}) error {
	statusURL, err := buildTargetURL(proxy.rawServerURL, "/session/status")
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, statusURL, nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var statuses map[string]map[string]any
	if err := json.NewDecoder(response.Body).Decode(&statuses); err != nil {
		return err
	}
	clear(activeSessions)
	for sessionID, status := range statuses {
		statusType, ok := status["type"].(string)
		if !ok || statusType == "" {
			return fmt.Errorf("OpenCode session status is missing type")
		}
		switch statusType {
		case "busy", "retry":
			activeSessions[sessionID] = struct{}{}
		case "idle":
		default:
			return fmt.Errorf("OpenCode session status type %q is not supported", statusType)
		}
	}
	return nil
}

func (proxy *Proxy) consumeActivityEvents(activeSessions map[string]struct{}) error {
	eventURL, err := buildTargetURL(proxy.rawServerURL, "/global/event")
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodGet, eventURL, nil)
	if err != nil {
		return err
	}
	request = request.WithContext(proxy.activityContext)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	scanner := bufio.NewScanner(response.Body)
	var eventLines []string
	for scanner.Scan() {
		select {
		case <-proxy.activityStop:
			return nil
		default:
		}
		line := scanner.Text()
		if line == "" {
			if err := proxy.applyActivityEvent(strings.Join(eventLines, "\n"), activeSessions); err != nil {
				return err
			}
			proxy.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
				manager.SetPlatformActive(len(activeSessions) > 0)
			})
			eventLines = nil
			continue
		}
		eventLines = append(eventLines, line)
	}
	return scanner.Err()
}

func (proxy *Proxy) applyActivityEvent(eventText string, activeSessions map[string]struct{}) error {
	data := sseData(eventText)
	if data == "" {
		return nil
	}
	var event map[string]any
	if err := json.Unmarshal([]byte(data), &event); err != nil {
		return err
	}
	payload, ok := event["payload"].(map[string]any)
	if !ok {
		payload = event
	}
	eventType, _ := payload["type"].(string)
	properties, _ := payload["properties"].(map[string]any)
	switch eventType {
	case "session.status":
		sessionID, err := requiredOpenCodeActivityString(properties, "sessionID")
		if err != nil {
			return err
		}
		status, _ := properties["status"].(map[string]any)
		statusType, ok := status["type"].(string)
		if !ok || statusType == "" {
			return fmt.Errorf("OpenCode session.status event is missing properties.status.type")
		}
		switch statusType {
		case "busy", "retry":
			activeSessions[sessionID] = struct{}{}
		case "idle":
			delete(activeSessions, sessionID)
		default:
			return fmt.Errorf("OpenCode session status type %q is not supported", statusType)
		}
	case "session.idle":
		sessionID, err := requiredOpenCodeActivityString(properties, "sessionID")
		if err != nil {
			return err
		}
		delete(activeSessions, sessionID)
	}
	return nil
}

func requiredOpenCodeActivityString(properties map[string]any, key string) (string, error) {
	value, ok := properties[key].(string)
	if !ok || value == "" {
		return "", fmt.Errorf("OpenCode event is missing required field 'properties.%s'", key)
	}
	return value, nil
}

func DeriveRawServerURL(readinessURL string) (string, error) {
	parsedURL, err := url.Parse(readinessURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse raw OpenCode server URL: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return "", fmt.Errorf("raw OpenCode server URL must use http or https scheme: %s", readinessURL)
	}
	if parsedURL.Path != "/global/health" {
		return "", fmt.Errorf("OpenCode process readiness URL must target /global/health: %s", readinessURL)
	}
	parsedURL.Path = ""
	parsedURL.RawQuery = ""
	parsedURL.Fragment = ""
	return strings.TrimRight(parsedURL.String(), "/"), nil
}

func buildTargetURL(rawServerURL string, path string) (string, error) {
	if !strings.HasPrefix(path, "/") {
		return "", fmt.Errorf("OpenCode proxy target path must start with /")
	}
	base, err := url.Parse(strings.TrimRight(rawServerURL, "/"))
	if err != nil {
		return "", err
	}
	target, err := base.Parse(path)
	if err != nil {
		return "", err
	}
	return target.String(), nil
}

func requestBody(body any) ([]byte, error) {
	if body == nil {
		return nil, nil
	}
	return json.Marshal(body)
}

func responseHeaders(headers http.Header) map[string]string {
	result := map[string]string{}
	for name, values := range headers {
		if len(values) > 0 {
			result[strings.ToLower(name)] = values[0]
		}
	}
	return result
}

func writeProxyResponse(ctx context.Context, connection *websocket.Conn, response Response) error {
	serialized, err := json.Marshal(response)
	if err != nil {
		return err
	}
	return connection.Write(ctx, websocket.MessageText, serialized)
}

func listenAddressFromWebSocketURL(rawURL string, label string) (string, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("%s proxy listen URL is invalid: %w", label, err)
	}
	if parsedURL.Scheme != "ws" {
		return "", fmt.Errorf("%s proxy listen URL must use ws scheme", label)
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("%s proxy listen URL host is required", label)
	}
	return parsedURL.Host, nil
}

func resolvedWebSocketURL(rawURL string, address net.Addr) (string, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("OpenCode proxy listen URL is invalid: %w", err)
	}
	tcpAddress, ok := address.(*net.TCPAddr)
	if !ok {
		return "", fmt.Errorf("OpenCode proxy listener address was not TCP: %s", address.String())
	}
	host := parsedURL.Hostname()
	if host == "" {
		return "", fmt.Errorf("OpenCode proxy listen URL host is required")
	}
	parsedURL.Host = net.JoinHostPort(host, fmt.Sprint(tcpAddress.Port))
	return parsedURL.String(), nil
}

func validateRawServerURL(rawURL string) error {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("failed to parse raw OpenCode server URL: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("raw OpenCode server URL must use http or https scheme: %s", rawURL)
	}
	return nil
}

func sseData(eventText string) string {
	var dataLines []string
	for _, line := range strings.Split(eventText, "\n") {
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	return strings.Join(dataLines, "\n")
}
