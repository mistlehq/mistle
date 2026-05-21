use super::*;

pub(super) fn spawn_agent_stream_task(
    stream_id: u32,
    runtime_socket: TunnelWebSocket,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> mpsc::UnboundedSender<Message> {
    let (mut writer, mut reader) = runtime_socket.split();
    let (sender, mut receiver) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                message = receiver.recv() => {
                    let Some(message) = message else {
                        let _ = writer.send(Message::Close(None)).await;
                        let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                            stream_id,
                            reason: None,
                        });
                        return;
                    };
                    let written_bytes = match &message {
                        Message::Text(payload) => Some(payload.len()),
                        Message::Binary(payload) => Some(payload.len()),
                        _ => None,
                    };
                    if let Err(error) = writer.send(message).await {
                        let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                            stream_id,
                            reason: Some(error.to_string()),
                        });
                        return;
                    }
                    if let Some(bytes) = written_bytes {
                        let _ = event_sender.send(TunnelSessionEvent::AgentWriteCompleted {
                            stream_id,
                            bytes,
                        });
                    }
                }
                message = reader.next() => {
                    match message {
                        Some(Ok(Message::Close(_))) | Some(Err(WebSocketError::ConnectionClosed)) | None => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                                stream_id,
                                reason: None,
                            });
                            return;
                        }
                        Some(Ok(message)) => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentMessage { stream_id, message });
                        }
                        Some(Err(error)) => {
                            let _ = event_sender.send(TunnelSessionEvent::AgentClosed {
                                stream_id,
                                reason: Some(error.to_string()),
                            });
                            return;
                        }
                    }
                }
            }
        }
    });
    sender
}

pub(in crate::tunnel::session) fn spawn_port_access_transport_event_sender(
    event_sender: &mpsc::UnboundedSender<TunnelSessionEvent>,
) -> mpsc::UnboundedSender<PortAccessTransportEvent> {
    let (transport_event_sender, mut transport_event_receiver) = mpsc::unbounded_channel();
    let event_sender = event_sender.clone();
    tokio::spawn(async move {
        while let Some(event) = transport_event_receiver.recv().await {
            if event_sender
                .send(TunnelSessionEvent::PortAccessTransport(event))
                .is_err()
            {
                return;
            }
        }
    });
    transport_event_sender
}

pub(super) fn spawn_agent_dial_task(
    stream_id: u32,
    runtime_endpoint_url: String,
    event_sender: mpsc::UnboundedSender<TunnelSessionEvent>,
) -> TokioJoinHandle<()> {
    tokio::spawn(async move {
        let result = match connect_async(&runtime_endpoint_url).await {
            Ok((runtime_socket, _)) => Ok(runtime_socket),
            Err(error) => Err(error.to_string()),
        };
        let _ = event_sender.send(TunnelSessionEvent::AgentDialed {
            stream_id,
            result: Box::new(result),
        });
    })
}
