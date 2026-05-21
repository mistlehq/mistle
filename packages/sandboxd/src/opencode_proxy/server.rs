use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::task::JoinSet;
use url::Url;

use crate::keepalive::KeepaliveManager;
use crate::opencode_proxy::OpenCodeProxyError;
use crate::opencode_proxy::activity::run_opencode_activity_monitor;
use crate::opencode_proxy::http::build_opencode_http_client;
use crate::opencode_proxy::relay::relay_opencode_proxy_connection;

const OPENCODE_PROXY_HEALTHCHECK_INTERVAL: Duration = Duration::from_millis(50);

pub(super) async fn run_opencode_proxy_runtime(
    listener_address: SocketAddr,
    listen_url: String,
    raw_server_url: String,
    keepalive_manager: Arc<Mutex<KeepaliveManager>>,
    shutdown_requested: Arc<AtomicBool>,
    startup_result_sender: std::sync::mpsc::Sender<Result<String, OpenCodeProxyError>>,
) -> Result<(), OpenCodeProxyError> {
    let listener = TcpListener::bind(listener_address).await.map_err(|error| {
        OpenCodeProxyError::BindListener {
            address: listener_address.to_string(),
            error,
        }
    })?;
    let local_address = listener
        .local_addr()
        .map_err(OpenCodeProxyError::ConfigureListener)?;
    listener
        .set_ttl(64)
        .map_err(OpenCodeProxyError::ConfigureListener)?;

    let final_listen_url = replace_url_port(&listen_url, local_address.port())?;
    let _ = startup_result_sender.send(Ok(final_listen_url));

    let client = build_opencode_http_client()?;
    let mut activity_monitor_task = tokio::spawn(run_opencode_activity_monitor(
        raw_server_url.clone(),
        client.clone(),
        keepalive_manager,
        shutdown_requested.clone(),
    ));
    let mut session_tasks = JoinSet::<Result<(), OpenCodeProxyError>>::new();
    while !shutdown_requested.load(Ordering::Relaxed) {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(OpenCodeProxyError::AcceptClient)?;
                let raw_server_url = raw_server_url.clone();
                let client = client.clone();
                session_tasks.spawn(async move {
                    relay_opencode_proxy_connection(stream, raw_server_url, client).await
                });
            }
            joined = session_tasks.join_next(), if !session_tasks.is_empty() => {
                match joined {
                    Some(Ok(Ok(()))) => {}
                    // One client relay failure should not take down the shared proxy runtime.
                    Some(Ok(Err(_error))) => {}
                    Some(Err(error)) if error.is_cancelled() => {}
                    Some(Err(_)) => return Err(OpenCodeProxyError::SessionPanicked),
                    None => {}
                }
            }
            _ = tokio::time::sleep(OPENCODE_PROXY_HEALTHCHECK_INTERVAL) => {}
            monitor_result = &mut activity_monitor_task => {
                return match monitor_result {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(error)) => Err(error),
                    Err(_) => Err(OpenCodeProxyError::SessionPanicked),
                };
            }
        }
    }

    activity_monitor_task.abort();
    match activity_monitor_task.await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(error) if error.is_cancelled() => {}
        Err(_) => return Err(OpenCodeProxyError::SessionPanicked),
    }

    session_tasks.abort_all();
    while let Some(joined) = session_tasks.join_next().await {
        match joined {
            Ok(Ok(())) => {}
            Ok(Err(_error)) => {}
            Err(error) if error.is_cancelled() => {}
            Err(_) => return Err(OpenCodeProxyError::SessionPanicked),
        }
    }

    Ok(())
}

pub(super) fn parse_opencode_proxy_listener_address(
    url: &Url,
) -> Result<SocketAddr, OpenCodeProxyError> {
    let Some(host) = url.host_str() else {
        return Err(OpenCodeProxyError::ListenUrlMissingHost {
            url: url.to_string(),
        });
    };
    let Some(port) = url.port() else {
        return Err(OpenCodeProxyError::ListenUrlMissingPort {
            url: url.to_string(),
        });
    };
    format!("{host}:{port}")
        .parse()
        .map_err(|error: std::net::AddrParseError| {
            OpenCodeProxyError::ConfigureRuntime(error.to_string())
        })
}

fn replace_url_port(url: &str, port: u16) -> Result<String, OpenCodeProxyError> {
    let mut parsed_url =
        Url::parse(url).map_err(|error| OpenCodeProxyError::ParseListenUrl(error.to_string()))?;
    parsed_url.set_port(Some(port)).map_err(|_| {
        OpenCodeProxyError::ConfigureRuntime("failed to set listener port".to_string())
    })?;
    Ok(parsed_url.to_string())
}
