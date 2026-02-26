mod config;
mod runtime;
mod server;

use std::net::SocketAddr;
use std::process::ExitCode;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use config::Config;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing_subscriber::fmt::format::FmtSpan;

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(error) = run().await {
        tracing::error!(error = %error, "sandbox runtime exited with error");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

async fn run() -> Result<()> {
    initialize_logger();

    let config = Config::load_from_env()?;
    let listen_addr = parse_listen_addr(&config.listen_addr)?;
    let shutdown = CancellationToken::new();

    let runtime_handle = tokio::spawn(runtime::run(shutdown.clone()));

    let listener = TcpListener::bind(listen_addr)
        .await
        .with_context(|| format!("failed to bind listen addr {}", config.listen_addr))?;

    tracing::info!(addr = config.listen_addr, "http server starting");
    let mut server_handle = spawn_server(listener, shutdown.clone());

    let mut server_exited = false;
    tokio::select! {
        signal = shutdown_signal() => {
            signal?;
        }
        result = &mut server_handle => {
            server_exited = true;
            let server_result = result.context("http server task failed")?;
            if let Err(error) = server_result {
                shutdown.cancel();
                let _ = runtime_handle.await;
                return Err(anyhow!("http server failed: {error}"));
            }
        }
    }

    shutdown.cancel();

    if !server_exited {
        tokio::time::timeout(Duration::from_secs(10), async {
            let server_result = server_handle.await.context("http server task failed")?;
            if let Err(error) = server_result {
                return Err(anyhow!("http server shutdown failed: {error}"));
            }
            Ok(())
        })
        .await
        .map_err(|_| anyhow!("http server shutdown failed: timed out"))??;
    }

    runtime_handle.await.context("runtime task failed")?;
    tracing::info!("sandbox runtime stopped");
    Ok(())
}

fn initialize_logger() {
    tracing_subscriber::fmt()
        .with_span_events(FmtSpan::NONE)
        .json()
        .with_current_span(false)
        .with_target(false)
        .with_level(true)
        .with_ansi(false)
        .init();
}

fn parse_listen_addr(listen_addr: &str) -> Result<SocketAddr> {
    let normalized_listen_addr = if listen_addr.starts_with(':') {
        format!("0.0.0.0{listen_addr}")
    } else {
        listen_addr.to_owned()
    };

    normalized_listen_addr
        .parse::<SocketAddr>()
        .with_context(|| {
            format!("SANDBOX_RUNTIME_LISTEN_ADDR must be a valid socket address, got {listen_addr}")
        })
}

fn spawn_server(
    listener: TcpListener,
    shutdown: CancellationToken,
) -> JoinHandle<Result<(), std::io::Error>> {
    tokio::spawn(async move {
        axum::serve(listener, server::router())
            .with_graceful_shutdown(shutdown.cancelled_owned())
            .await
    })
}

#[cfg(unix)]
async fn shutdown_signal() -> Result<()> {
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .context("failed to install SIGTERM signal handler")?;

    tokio::select! {
        _ = tokio::signal::ctrl_c() => Ok(()),
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() -> Result<()> {
    tokio::signal::ctrl_c()
        .await
        .context("failed to listen for Ctrl+C")
}
