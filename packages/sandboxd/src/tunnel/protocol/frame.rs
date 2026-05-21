use super::*;

/// Encodes one outbound stream data frame for websocket binary transport.
pub fn encode_stream_data_frame(
    stream_id: u32,
    payload_kind: u8,
    payload: &[u8],
) -> Result<Vec<u8>, TunnelProtocolError> {
    validate_stream_id(stream_id)?;
    validate_payload_kind(payload_kind)?;

    let mut encoded = Vec::with_capacity(DATA_FRAME_HEADER_LEN + payload.len());
    encoded.push(DATA_FRAME_KIND);
    encoded.extend_from_slice(&stream_id.to_be_bytes());
    encoded.push(payload_kind);
    encoded.extend_from_slice(payload);
    Ok(encoded)
}

/// Decodes one inbound websocket binary stream data frame.
pub fn decode_stream_data_frame(payload: &[u8]) -> Result<StreamDataFrame, TunnelProtocolError> {
    if payload.len() < DATA_FRAME_HEADER_LEN {
        return Err(TunnelProtocolError::new(format!(
            "data frame must be at least {DATA_FRAME_HEADER_LEN} bytes long"
        )));
    }
    if payload[0] != DATA_FRAME_KIND {
        return Err(TunnelProtocolError::new(format!(
            "frameKind is not supported: {}",
            payload[0]
        )));
    }

    let stream_id = u32::from_be_bytes([payload[1], payload[2], payload[3], payload[4]]);
    validate_stream_id(stream_id)?;
    validate_payload_kind(payload[5])?;

    Ok(StreamDataFrame {
        stream_id,
        payload_kind: payload[5],
        payload: payload[DATA_FRAME_HEADER_LEN..].to_vec(),
    })
}
