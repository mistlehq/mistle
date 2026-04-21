use std::collections::{BTreeMap, VecDeque};
use std::io::ErrorKind;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{accept_async, connect_async};
use tungstenite::Message;

use crate::codex_proxy::types::{BufferedSuccessResponse, PendingClientRequest, ProxyClientKind};
use crate::codex_proxy::{
    CodexProxyError, CodexSessionManagerError, CodexSessionManagerHandle,
    MISTLE_AGENT_CLIENT_TITLE, RetainReason, is_connection_termination_error,
};
const TURN_START_METHOD: &str = "turn/start";
const TURN_STEER_METHOD: &str = "turn/steer";
const RETENTION_FAILURE_ERROR_CODE: i64 = -32000;
const RETENTION_FAILURE_ERROR_MESSAGE: &str =
    "sandboxd failed to retain Codex thread subscription for background execution";

struct RetentionResult {
    request_key: String,
    result: Result<(), CodexSessionManagerError>,
}

pub async fn relay_codex_proxy_connection(
    client_stream: TcpStream,
    raw_app_server_url: &str,
    session_manager_handle: CodexSessionManagerHandle,
    mut shutdown_receiver: watch::Receiver<bool>,
) -> Result<(), CodexProxyError> {
    let mut client_socket = accept_async(client_stream)
        .await
        .map_err(|error| CodexProxyError::AcceptHandshake(error.to_string()))?;
    let (mut raw_socket, _) = connect_async(raw_app_server_url)
        .await
        .map_err(CodexProxyError::ConnectRaw)?;

    let (retention_result_sender, mut retention_result_receiver) = mpsc::unbounded_channel();
    let mut client_kind = ProxyClientKind::Unknown;
    let mut pending_requests = BTreeMap::<String, PendingClientRequest>::new();
    let mut buffered_success_responses = VecDeque::<BufferedSuccessResponse>::new();
    let mut next_response_sequence = 0_u64;

    loop {
        tokio::select! {
            _ = shutdown_receiver.changed() => return Ok(()),
            retention_result = retention_result_receiver.recv() => {
                if let Some(retention_result) = retention_result {
                    record_retention_result(&retention_result, &mut buffered_success_responses);
                } else {
                    return Ok(());
                }
            }
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

                        track_client_message(&message, &mut client_kind, &mut pending_requests)?;
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

                        if let Some((request_key, thread_id)) =
                            matched_retention_target(&message, &client_kind, &mut pending_requests)?
                        {
                            next_response_sequence = next_response_sequence.saturating_add(1);
                            buffered_success_responses.push_back(BufferedSuccessResponse {
                                request_id: parse_json_rpc_id_from_message(&message)?,
                                response_sequence: next_response_sequence,
                                payload: message,
                                subscription_retention_result: None,
                            });
                            let retention_result_sender = retention_result_sender.clone();
                            let session_manager_handle = session_manager_handle.clone();
                            tokio::spawn(async move {
                                let result = session_manager_handle
                                    .retain_thread(
                                        thread_id,
                                        RetainReason::MistleAgentBackgroundExecution,
                                    )
                                    .await;
                                let _ = retention_result_sender.send(RetentionResult {
                                    request_key,
                                    result,
                                });
                            });
                        } else {
                            client_socket
                                .send(message)
                                .await
                                .map_err(CodexProxyError::WriteSocket)?;
                        }
                    }
                    Some(Err(error)) if is_connection_termination_error(&error) => return Ok(()),
                    Some(Err(error)) => return Err(CodexProxyError::ReadSocket(error)),
                    None => return Ok(()),
                }
            }
        }

        flush_buffered_success_responses(&mut client_socket, &mut buffered_success_responses)
            .await?;
    }
}

fn track_client_message(
    message: &Message,
    client_kind: &mut ProxyClientKind,
    pending_requests: &mut BTreeMap<String, PendingClientRequest>,
) -> Result<(), CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Ok(());
    };

    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Ok(());
    };

    if method == "initialize" {
        *client_kind = match value["params"]["clientInfo"]["title"].as_str() {
            Some(MISTLE_AGENT_CLIENT_TITLE) => ProxyClientKind::MistleAgentClient,
            _ => ProxyClientKind::Other,
        };
    }

    let Some(request_id) = value.get("id").cloned() else {
        return Ok(());
    };
    let Some(request_key) = json_rpc_id_key(&request_id) else {
        return Ok(());
    };
    let thread_id = match method {
        TURN_START_METHOD | TURN_STEER_METHOD => value["params"]["threadId"]
            .as_str()
            .map(ToString::to_string),
        _ => None,
    };
    pending_requests.insert(
        request_key,
        PendingClientRequest {
            method: method.to_string(),
            thread_id,
        },
    );

    Ok(())
}

fn matched_retention_target(
    message: &Message,
    client_kind: &ProxyClientKind,
    pending_requests: &mut BTreeMap<String, PendingClientRequest>,
) -> Result<Option<(String, String)>, CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Ok(None);
    };
    let Some(response_id) = value.get("id").cloned() else {
        return Ok(None);
    };
    let Some(request_key) = json_rpc_id_key(&response_id) else {
        return Ok(None);
    };
    let Some(pending_request) = pending_requests.remove(&request_key) else {
        return Ok(None);
    };

    if *client_kind != ProxyClientKind::MistleAgentClient {
        return Ok(None);
    }
    if value.get("error").is_some() {
        return Ok(None);
    }

    let Some(thread_id) = pending_request.thread_id else {
        return Ok(None);
    };
    let has_turn_id = match pending_request.method.as_str() {
        TURN_START_METHOD => value["result"]["turn"]["id"].as_str().is_some(),
        TURN_STEER_METHOD => value["result"]["turnId"].as_str().is_some(),
        _ => false,
    };
    if !has_turn_id {
        return Ok(None);
    }

    Ok(Some((request_key, thread_id)))
}

fn record_retention_result(
    retention_result: &RetentionResult,
    buffered_success_responses: &mut VecDeque<BufferedSuccessResponse>,
) {
    if let Some(buffered_success_response) =
        buffered_success_responses
            .iter_mut()
            .find(|buffered_success_response| {
                json_rpc_id_key(&buffered_success_response.request_id).as_deref()
                    == Some(retention_result.request_key.as_str())
            })
    {
        buffered_success_response.subscription_retention_result =
            Some(clone_retention_result(&retention_result.result));
    }
}

async fn flush_buffered_success_responses(
    client_socket: &mut tokio_tungstenite::WebSocketStream<TcpStream>,
    buffered_success_responses: &mut VecDeque<BufferedSuccessResponse>,
) -> Result<(), CodexProxyError> {
    for buffered_success_response in
        take_ready_buffered_success_responses(buffered_success_responses)
    {
        match buffered_success_response
            .subscription_retention_result
            .expect("buffered success response should have a retention result")
        {
            Ok(()) => client_socket
                .send(buffered_success_response.payload)
                .await
                .map_err(CodexProxyError::WriteSocket)?,
            Err(_) => client_socket
                .send(Message::Text(
                    json!({
                        "id": buffered_success_response.request_id,
                        "error": {
                            "code": RETENTION_FAILURE_ERROR_CODE,
                            "message": RETENTION_FAILURE_ERROR_MESSAGE
                        }
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .map_err(CodexProxyError::WriteSocket)?,
        }
    }

    Ok(())
}

fn take_ready_buffered_success_responses(
    buffered_success_responses: &mut VecDeque<BufferedSuccessResponse>,
) -> Vec<BufferedSuccessResponse> {
    let mut ready_responses = Vec::new();
    while buffered_success_responses
        .front()
        .is_some_and(|buffered_success_response| {
            buffered_success_response
                .subscription_retention_result
                .is_some()
        })
    {
        ready_responses.push(
            buffered_success_responses
                .pop_front()
                .expect("front buffered success response should exist"),
        );
    }

    ready_responses
}

fn clone_retention_result(
    result: &Result<(), CodexSessionManagerError>,
) -> Result<(), CodexSessionManagerError> {
    match result {
        Ok(()) => Ok(()),
        Err(CodexSessionManagerError::CommandChannelClosed) => {
            Err(CodexSessionManagerError::CommandChannelClosed)
        }
        Err(CodexSessionManagerError::RequestRejected { method, message }) => {
            Err(CodexSessionManagerError::RequestRejected {
                method,
                message: message.clone(),
            })
        }
        Err(CodexSessionManagerError::RequestFailed { method, message }) => {
            Err(CodexSessionManagerError::RequestFailed {
                method,
                message: message.clone(),
            })
        }
    }
}

fn parse_json_value_from_message(message: &Message) -> Result<Option<Value>, CodexProxyError> {
    let Message::Text(payload) = message else {
        return Ok(None);
    };
    let value = serde_json::from_str(payload.as_str()).map_err(CodexProxyError::InvalidJson)?;
    Ok(Some(value))
}

fn parse_json_rpc_id_from_message(message: &Message) -> Result<Value, CodexProxyError> {
    let Some(value) = parse_json_value_from_message(message)? else {
        return Err(CodexProxyError::InvalidJson(serde_json::Error::io(
            std::io::Error::new(
                ErrorKind::InvalidData,
                "Codex proxy expected a JSON-RPC text message with an id",
            ),
        )));
    };

    value.get("id").cloned().ok_or_else(|| {
        CodexProxyError::InvalidJson(serde_json::Error::io(std::io::Error::new(
            ErrorKind::InvalidData,
            "Codex proxy expected a JSON-RPC message id",
        )))
    })
}

fn json_rpc_id_key(request_id: &Value) -> Option<String> {
    match request_id {
        Value::Null => None,
        _ => Some(request_id.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use serde_json::json;
    use tungstenite::Message;

    use crate::codex_proxy::{
        BufferedSuccessResponse, CodexSessionManagerError, PendingClientRequest, ProxyClientKind,
    };

    use super::{
        matched_retention_target, take_ready_buffered_success_responses, track_client_message,
    };

    #[test]
    fn classifies_mistle_agent_client_initialize_requests() {
        let mut client_kind = ProxyClientKind::Unknown;
        let mut pending_requests = std::collections::BTreeMap::new();

        track_client_message(
            &Message::Text(
                json!({
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "clientInfo": {
                            "name": "codex_cli_rs",
                            "title": "Mistle Agent Client",
                            "version": "0.1.0"
                        }
                    }
                })
                .to_string()
                .into(),
            ),
            &mut client_kind,
            &mut pending_requests,
        )
        .expect("initialize request should parse");

        assert_eq!(client_kind, ProxyClientKind::MistleAgentClient);
    }

    #[test]
    fn matches_turn_steer_success_for_retention() {
        let mut pending_requests = std::collections::BTreeMap::from([(
            "17".to_string(),
            PendingClientRequest {
                method: "turn/steer".to_string(),
                thread_id: Some("thr_123".to_string()),
            },
        )]);

        let matched = matched_retention_target(
            &Message::Text(
                json!({
                    "id": 17,
                    "result": {
                        "turnId": "turn_123"
                    }
                })
                .to_string()
                .into(),
            ),
            &ProxyClientKind::MistleAgentClient,
            &mut pending_requests,
        )
        .expect("turn/steer response should parse");

        assert_eq!(matched, Some(("17".to_string(), "thr_123".to_string())));
    }

    #[test]
    fn ready_responses_flush_only_from_the_head_of_the_queue() {
        let mut buffered_success_responses = VecDeque::from([
            BufferedSuccessResponse {
                request_id: json!(1),
                response_sequence: 1,
                payload: Message::Text("{\"id\":1}".to_string().into()),
                subscription_retention_result: None,
            },
            BufferedSuccessResponse {
                request_id: json!(2),
                response_sequence: 2,
                payload: Message::Text("{\"id\":2}".to_string().into()),
                subscription_retention_result: Some(Err(
                    CodexSessionManagerError::CommandChannelClosed,
                )),
            },
        ]);

        assert!(take_ready_buffered_success_responses(&mut buffered_success_responses).is_empty());
        assert_eq!(buffered_success_responses.len(), 2);

        buffered_success_responses[0].subscription_retention_result = Some(Ok(()));

        let ready_responses =
            take_ready_buffered_success_responses(&mut buffered_success_responses);
        assert_eq!(ready_responses.len(), 2);
        assert_eq!(ready_responses[0].request_id, json!(1));
        assert_eq!(ready_responses[1].request_id, json!(2));
        assert!(buffered_success_responses.is_empty());
    }
}
