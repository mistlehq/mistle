use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::watch;
use tokio_tungstenite::{accept_async, connect_async};
use tungstenite::Message;

use crate::codex_proxy::{
    CodexProxyError, CodexSessionManagerHandle, is_connection_termination_error,
};

pub async fn relay_codex_proxy_connection(
    client_stream: TcpStream,
    raw_app_server_url: &str,
    _session_manager_handle: CodexSessionManagerHandle,
    mut shutdown_receiver: watch::Receiver<bool>,
) -> Result<(), CodexProxyError> {
    let mut client_socket = accept_async(client_stream)
        .await
        .map_err(|error| CodexProxyError::AcceptHandshake(error.to_string()))?;
    let (mut raw_socket, _) = connect_async(raw_app_server_url)
        .await
        .map_err(CodexProxyError::ConnectRaw)?;

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => return Ok(()),
            client_message = client_socket.next() => {
                match client_message {
                    Some(Ok(message)) => {
                        if let Message::Close(frame) = message {
                            raw_socket
                                .send(Message::Close(frame))
                                .await
                                .map_err(CodexProxyError::WriteSocket)?;
                            return Ok(());
                        }

                        raw_socket
                            .send(message)
                            .await
                            .map_err(CodexProxyError::WriteSocket)?;
                    }
                    Some(Err(error)) if is_connection_termination_error(&error) => return Ok(()),
                    Some(Err(error)) => return Err(CodexProxyError::ReadSocket(error)),
                    None => return Ok(()),
                }
            }
            raw_message = raw_socket.next() => {
                match raw_message {
                    Some(Ok(message)) => {
                        if let Message::Close(frame) = message {
                            client_socket
                                .send(Message::Close(frame))
                                .await
                                .map_err(CodexProxyError::WriteSocket)?;
                            return Ok(());
                        }

                        client_socket
                            .send(message)
                            .await
                            .map_err(CodexProxyError::WriteSocket)?;
                    }
                    Some(Err(error)) if is_connection_termination_error(&error) => return Ok(()),
                    Some(Err(error)) => return Err(CodexProxyError::ReadSocket(error)),
                    None => return Ok(()),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use tungstenite::Error as WebSocketError;

    use crate::codex_proxy::is_connection_termination_error;

    #[test]
    fn treats_connection_closed_as_termination() {
        assert!(is_connection_termination_error(
            &WebSocketError::ConnectionClosed
        ));
    }
}
