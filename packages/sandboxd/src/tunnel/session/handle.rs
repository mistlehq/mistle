//! Public tunnel session handle and thread startup wiring.

use std::collections::{BTreeMap, BTreeSet};
use std::panic::{self, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::Duration as StdDuration;

use serde_json::Value;
use tokio::runtime::Builder;
use tokio::sync::mpsc;
use url::Url;

use crate::cgroups::DEFAULT_CGROUP_ROOT;
use crate::keepalive::KeepaliveManager;
use crate::protocol::startup::StartupInput;
use crate::runtime::readiness::RuntimeReadinessManager;
use crate::supervision::{SandboxdSupervisorHandle, SupervisedComponent};
use crate::time::{Clock, Sleeper};
#[cfg(not(test))]
use crate::tunnel::session::DEFAULT_ATTACHMENT_ROOT;
use crate::tunnel::session::bootstrap::startup_transparent_passthrough_socket_mark;
use crate::tunnel::session::egress::GatewayEgressTokenProvider;
use crate::tunnel::session::error::TunnelSessionError;
use crate::tunnel::session::lifecycle::{format_panic_payload, update_tunnel_supervision_details};
use crate::tunnel::session::operation::{
    OPERATION_RECORD_CHANNEL_CAPACITY, OperationStreamMessage,
};
use crate::tunnel::session::router::{derive_startup_operation_id, startup_operation_kind};
use crate::tunnel::session::runner::run_tunnel_supervisor;
use crate::tunnel::session::signing::{TunnelSigningRequest, TunnelSigningResponse};
use crate::tunnel::session::state::{
    TunnelSessionRequest, TunnelSessionRuntime, TunnelSessionRuntimeConnectionState,
};

const DEFAULT_AGENT_ENDPOINT_UPDATE_TIMEOUT: StdDuration = StdDuration::from_secs(10);
const DEFAULT_SIGNING_REQUEST_TIMEOUT: StdDuration = StdDuration::from_secs(120);
const DEFAULT_RUNTIME_ENV_UPDATE_TIMEOUT: StdDuration = StdDuration::from_secs(10);

/// Owns the background tunnel session thread for the initialized daemon.
pub struct TunnelSession {
    shutdown_requested: Arc<AtomicBool>,
    request_sender: mpsc::UnboundedSender<TunnelSessionRequest>,
    thread: Option<JoinHandle<Result<(), TunnelSessionError>>>,
    supervisor_handle: SandboxdSupervisorHandle,
}

impl TunnelSession {
    /// Starts one live bootstrap tunnel session thread for the initialized daemon.
    pub fn start(
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        agent_endpoint_url: Option<String>,
        runtime_env: BTreeMap<String, String>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
    ) -> Result<Self, TunnelSessionError> {
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)?;
        let supervisor_handle = SandboxdSupervisorHandle::new(
            sandbox_instance_id,
            clock.clone(),
            BTreeSet::from([SupervisedComponent::TunnelSession]),
        );

        Self::start_with_supervisor(
            startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            agent_endpoint_url,
            runtime_env,
            clock,
            sleeper,
            supervisor_handle,
        )
    }

    /// Starts one live bootstrap tunnel session thread using the shared supervisor boundary.
    #[allow(clippy::too_many_arguments)]
    pub fn start_with_supervisor(
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        agent_endpoint_url: Option<String>,
        runtime_env: BTreeMap<String, String>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Self, TunnelSessionError> {
        let sandbox_instance_id = derive_sandbox_instance_id(&startup_input.tunnel_gateway_ws_url)?;
        supervisor_handle.replace_component_details(
            SupervisedComponent::TunnelSession,
            BTreeMap::from([(
                "gatewayWsUrl".to_string(),
                startup_input.tunnel_gateway_ws_url.clone(),
            )]),
        );
        supervisor_handle.mark_component_starting(SupervisedComponent::TunnelSession);
        let attachment_root = resolve_default_attachment_root();

        let shutdown_requested = Arc::new(AtomicBool::new(false));
        let (request_sender, request_receiver) = mpsc::unbounded_channel();
        let (startup_result_sender, startup_result_receiver) = std::sync::mpsc::channel();
        let thread = thread::spawn({
            let shutdown_requested = shutdown_requested.clone();
            let thread_supervisor_handle = supervisor_handle.clone();
            let cgroup_root = PathBuf::from(DEFAULT_CGROUP_ROOT);
            let runtime = TunnelSessionRuntime {
                keepalive_manager,
                runtime_readiness_manager,
                connection_state: Arc::new(RwLock::new(TunnelSessionRuntimeConnectionState {
                    agent_endpoint_url,
                    runtime_env,
                })),
                cgroup_root,
                attachment_root,
                sandbox_instance_id,
                gateway_ws_url: startup_input.tunnel_gateway_ws_url.clone(),
                operation_id: derive_startup_operation_id(&startup_input.tunnel_gateway_ws_url),
                operation_kind: startup_operation_kind(startup_input),
                transparent_passthrough_socket_mark: startup_transparent_passthrough_socket_mark(
                    startup_input,
                ),
                shutdown_requested,
                clock,
                sleeper,
                supervisor_handle: supervisor_handle.clone(),
            };
            let connected_url = startup_input.tunnel_gateway_ws_url.clone();
            let panic_connected_url = connected_url.clone();
            let bootstrap_token = startup_input.bootstrap_token.clone();
            let tunnel_exchange_token = startup_input.tunnel_exchange_token.clone();
            move || match panic::catch_unwind(AssertUnwindSafe(move || {
                let runtime_builder = Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                    .map_err(|error| {
                        TunnelSessionError::ConfigureTunnelSocket(error.to_string())
                    })?;

                let startup_result_sender = startup_result_sender;
                runtime_builder.block_on(async move {
                    run_tunnel_supervisor(
                        runtime,
                        &connected_url,
                        &bootstrap_token,
                        &tunnel_exchange_token,
                        request_receiver,
                        startup_result_sender,
                    )
                    .await
                })
            })) {
                Ok(result) => result,
                Err(payload) => {
                    let panic_text = format_panic_payload(payload.as_ref());
                    thread_supervisor_handle.mark_component_restarting(
                        SupervisedComponent::TunnelSession,
                        panic_text.clone(),
                    );
                    update_tunnel_supervision_details(
                        &thread_supervisor_handle,
                        &panic_connected_url,
                        Some("tunnel_thread_panic"),
                        None,
                        None,
                    );
                    thread_supervisor_handle.emit_component_exited(
                        SupervisedComponent::TunnelSession,
                        "panic",
                        Some(&panic_text),
                        &[
                            ("exitKind", Value::String("panic".to_string())),
                            ("panicBoundary", Value::String("tunnel_thread".to_string())),
                        ],
                    );
                    Err(TunnelSessionError::SessionPanicked)
                }
            }
        });

        match startup_result_receiver.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = thread.join();
                return Err(error);
            }
            Err(_) => {
                let _ = thread.join();
                return Err(TunnelSessionError::SessionPanicked);
            }
        }

        Ok(Self {
            shutdown_requested,
            request_sender,
            thread: Some(thread),
            supervisor_handle,
        })
    }

    /// Starts a bootstrap tunnel with no runtime capabilities attached yet.
    pub fn start_minimal_with_supervisor(
        startup_input: &StartupInput,
        keepalive_manager: Arc<Mutex<KeepaliveManager>>,
        runtime_readiness_manager: Arc<Mutex<RuntimeReadinessManager>>,
        clock: Arc<dyn Clock>,
        sleeper: Arc<dyn Sleeper>,
        supervisor_handle: SandboxdSupervisorHandle,
    ) -> Result<Self, TunnelSessionError> {
        Self::start_with_supervisor(
            startup_input,
            keepalive_manager,
            runtime_readiness_manager,
            None,
            BTreeMap::new(),
            clock,
            sleeper,
            supervisor_handle,
        )
    }

    pub fn request_signing(
        &self,
        request: TunnelSigningRequest,
    ) -> Result<TunnelSigningResponse, TunnelSessionError> {
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        self.request_sender
            .send(TunnelSessionRequest::Signing {
                request: Box::new(request),
                response_sender,
            })
            .map_err(|error| TunnelSessionError::Signing(error.to_string()))?;

        response_receiver
            .recv_timeout(DEFAULT_SIGNING_REQUEST_TIMEOUT)
            .map_err(|error| TunnelSessionError::Signing(error.to_string()))?
    }

    pub fn attach_gateway_egress_token_provider(&self, provider: &GatewayEgressTokenProvider) {
        provider.attach(self.request_sender.clone());
    }

    pub fn set_agent_endpoint_url(
        &self,
        agent_endpoint_url: Option<String>,
    ) -> Result<(), TunnelSessionError> {
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        self.request_sender
            .send(TunnelSessionRequest::SetAgentEndpoint {
                agent_endpoint_url,
                response_sender,
            })
            .map_err(|error| TunnelSessionError::AgentDial(error.to_string()))?;

        response_receiver
            .recv_timeout(DEFAULT_AGENT_ENDPOINT_UPDATE_TIMEOUT)
            .map_err(|error| TunnelSessionError::AgentDial(error.to_string()))?
    }

    pub fn set_runtime_environment(
        &self,
        runtime_env: BTreeMap<String, String>,
    ) -> Result<(), TunnelSessionError> {
        let (response_sender, response_receiver) = std::sync::mpsc::channel();
        self.request_sender
            .send(TunnelSessionRequest::SetRuntimeEnvironment {
                runtime_env,
                response_sender,
            })
            .map_err(|error| TunnelSessionError::Processes(error.to_string()))?;

        response_receiver
            .recv_timeout(DEFAULT_RUNTIME_ENV_UPDATE_TIMEOUT)
            .map_err(|error| TunnelSessionError::Processes(error.to_string()))?
    }

    pub fn operation_record_sender(&self) -> mpsc::Sender<OperationStreamMessage> {
        let (record_sender, mut record_receiver) = mpsc::channel(OPERATION_RECORD_CHANNEL_CAPACITY);
        let request_sender = self.request_sender.clone();
        thread::spawn(move || {
            while let Some(message) = record_receiver.blocking_recv() {
                let request = match message {
                    OperationStreamMessage::Record(line) => {
                        TunnelSessionRequest::OperationRecord { line }
                    }
                    OperationStreamMessage::Close { response_sender } => {
                        TunnelSessionRequest::OperationClose { response_sender }
                    }
                };
                if request_sender.send(request).is_err() {
                    return;
                }
            }
        });
        record_sender
    }

    /// Stops the live bootstrap tunnel session and waits for its thread to exit.
    pub fn close(mut self) {
        self.shutdown_requested.store(true, Ordering::Relaxed);
        let Some(thread) = self.thread.take() else {
            self.supervisor_handle.mark_component_restarting(
                SupervisedComponent::TunnelSession,
                "tunnel session thread missing",
            );
            self.supervisor_handle.emit_component_exited(
                SupervisedComponent::TunnelSession,
                "thread_missing",
                Some("tunnel session thread missing"),
                &[("exitKind", Value::String("thread_missing".to_string()))],
            );
            self.supervisor_handle
                .mark_component_stopped(SupervisedComponent::TunnelSession);
            return;
        };

        match thread.join() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let error_text = error.to_string();
                self.supervisor_handle.mark_component_restarting(
                    SupervisedComponent::TunnelSession,
                    error_text.clone(),
                );
                self.supervisor_handle.emit_component_exited(
                    SupervisedComponent::TunnelSession,
                    "thread_returned",
                    Some(&error_text),
                    &[("exitKind", Value::String("thread_returned".to_string()))],
                );
            }
            Err(_) => {
                self.supervisor_handle.mark_component_restarting(
                    SupervisedComponent::TunnelSession,
                    "tunnel session thread panicked",
                );
                self.supervisor_handle.emit_component_exited(
                    SupervisedComponent::TunnelSession,
                    "panic",
                    Some("tunnel session thread panicked"),
                    &[
                        ("exitKind", Value::String("panic".to_string())),
                        ("panicBoundary", Value::String("tunnel_thread".to_string())),
                    ],
                );
            }
        }
        self.supervisor_handle
            .mark_component_stopped(SupervisedComponent::TunnelSession);
    }
}

fn resolve_default_attachment_root() -> PathBuf {
    if let Some(attachment_root) = crate::test_support::attachment_root_override() {
        return attachment_root;
    }

    #[cfg(test)]
    {
        std::env::temp_dir().join(format!(
            "mistle-sandboxd-test-attachments-{}",
            std::process::id()
        ))
    }

    #[cfg(not(test))]
    PathBuf::from(DEFAULT_ATTACHMENT_ROOT)
}

pub(crate) fn derive_sandbox_instance_id(
    gateway_ws_url: &str,
) -> Result<String, TunnelSessionError> {
    let parsed_url = Url::parse(gateway_ws_url)
        .map_err(|error| TunnelSessionError::InvalidGatewayUrl(error.to_string()))?;
    let Some(segment) = parsed_url
        .path_segments()
        .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
    else {
        return Err(TunnelSessionError::InvalidGatewayUrl(
            "tunnel gateway url must end with the sandbox instance id path segment".to_string(),
        ));
    };

    Ok(segment.to_string())
}
