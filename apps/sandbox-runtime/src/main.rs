mod config;
mod server;

use std::net::SocketAddr;
use std::process::ExitCode;

use anyhow::{Context, Result};
use config::Config;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> ExitCode {
    if let Err(error) = run().await {
        eprintln!("sandbox runtime exited with error: {error}");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

async fn run() -> Result<()> {
    let config = Config::load_from_env()?;
    let listen_addr = parse_listen_addr(&config.listen_addr)?;

    let listener = TcpListener::bind(listen_addr)
        .await
        .with_context(|| format!("failed to bind listen addr {}", config.listen_addr))?;

    axum::serve(listener, server::router())
        .await
        .context("http server failed")
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
