//! Async runtime entrypoint for the Codex websocket proxy listener.
//!
//! The supervisor starts this module on a dedicated thread. It owns the listener
//! loop and session-manager task, while each accepted connection is delegated to
//! the proxy-session relay.

use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::task::JoinSet;
use url::Url;

use crate::codex_proxy::error::CodexProxyError;
use crate::codex_proxy::idempotency::SharedIdempotencyStore;
use crate::codex_proxy::proxy_session::relay_codex_proxy_connection;
use crate::codex_proxy::session_manager;
use crate::codex_proxy::types::CodexSessionManagerHealthState;
use crate::keepalive::KeepaliveManager;

pub(crate) struct CodexProxyStartup {
    pub(crate) listen_url: String,
    pub(crate) session_manager_health_receiver: watch::Receiver<CodexSessionManagerHealthState>,
}

pub(crate) async fn run_codex_proxy_runtime(
    listener_address: &str,
    mut listen_url_template: Url,
    raw_app_server_url: &str,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    mut shutdown_receiver: watch::Receiver<bool>,
    startup_result_sender: mpsc::Sender<Result<CodexProxyStartup, CodexProxyError>>,
    idempotency_store: Option<SharedIdempotencyStore>,
) -> Result<(), CodexProxyError> {
    let listener = TcpListener::bind(listener_address).await.map_err(|error| {
        CodexProxyError::BindListener {
            address: listener_address.to_string(),
            error,
        }
    })?;
    let local_address = listener
        .local_addr()
        .map_err(CodexProxyError::ConfigureListener)?;

    if listen_url_template
        .set_port(Some(local_address.port()))
        .is_err()
    {
        return Err(CodexProxyError::ConfigureRuntime(format!(
            "failed to apply Codex proxy listener port to {listen_url_template}"
        )));
    }

    let (session_manager_handle, mut session_manager_task, session_manager_health_receiver) =
        session_manager::spawn_codex_session_manager(
            raw_app_server_url.to_string(),
            keepalive_manager,
            shutdown_receiver.clone(),
        );
    let _ = startup_result_sender.send(Ok(CodexProxyStartup {
        listen_url: listen_url_template.to_string(),
        session_manager_health_receiver,
    }));

    let mut session_tasks = JoinSet::<Result<(), CodexProxyError>>::new();

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => break,
            manager_result = &mut session_manager_task => {
                match manager_result {
                    Ok(Ok(())) => return Ok(()),
                    Ok(Err(error)) => return Err(error),
                    Err(_) => return Err(CodexProxyError::SessionPanicked),
                }
            }
            Some(session_result) = session_tasks.join_next(), if !session_tasks.is_empty() => {
                match session_result {
                    Ok(Ok(())) => {}
                    // One client relay failure should not take down the shared proxy runtime.
                    Ok(Err(_error)) => {}
                    Err(_) => return Err(CodexProxyError::SessionPanicked),
                }
            }
            accept_result = listener.accept() => {
                let (stream, _) = accept_result.map_err(CodexProxyError::AcceptClient)?;
                let task_raw_url = raw_app_server_url.to_string();
                let task_handle = session_manager_handle.clone();
                let task_shutdown = shutdown_receiver.clone();
                let idempotency_store = idempotency_store.clone();
                session_tasks.spawn(async move {
                    relay_codex_proxy_connection(
                        stream,
                        &task_raw_url,
                        task_handle,
                        task_shutdown,
                        idempotency_store,
                    )
                    .await
                });
            }
        }
    }

    session_tasks.abort_all();
    while let Some(session_result) = session_tasks.join_next().await {
        match session_result {
            Ok(Ok(())) => {}
            Ok(Err(_error)) => {}
            Err(join_error) if join_error.is_cancelled() => {}
            Err(_) => return Err(CodexProxyError::SessionPanicked),
        }
    }

    match session_manager_task.await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(CodexProxyError::SessionPanicked),
    }
}
