//! Activation payload reading for `sandboxd activate`.

use std::fmt;
use std::io::{Read, Take};

/// Describes how a thin lifecycle client should read one startup payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupPayloadSource {
    /// Read until stdin reaches EOF. This is the legacy transport used by
    /// providers that can close stdin after sending the payload.
    StdinUntilEof,
    /// Read exactly this many bytes from stdin. This supports providers that
    /// can write stdin bytes but cannot signal EOF.
    StdinBytes(usize),
}

/// Describes why reading a startup payload failed before JSON decoding.
#[derive(Debug)]
pub enum StartupPayloadReadError {
    Read(std::io::Error),
}

impl fmt::Display for StartupPayloadReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for StartupPayloadReadError {}

pub fn read_startup_payload<R>(
    reader: &mut R,
    source: StartupPayloadSource,
) -> Result<Vec<u8>, StartupPayloadReadError>
where
    R: Read,
{
    match source {
        StartupPayloadSource::StdinUntilEof => read_until_eof(reader),
        StartupPayloadSource::StdinBytes(byte_count) => read_exact_bytes(reader, byte_count),
    }
}

fn read_until_eof<R>(reader: &mut R) -> Result<Vec<u8>, StartupPayloadReadError>
where
    R: Read,
{
    let mut raw_request = Vec::new();
    reader
        .read_to_end(&mut raw_request)
        .map_err(StartupPayloadReadError::Read)?;
    Ok(raw_request)
}

fn read_exact_bytes<R>(
    reader: &mut R,
    byte_count: usize,
) -> Result<Vec<u8>, StartupPayloadReadError>
where
    R: Read,
{
    let mut bounded_reader: Take<&mut R> = reader.take(byte_count as u64);
    let mut raw_request = Vec::with_capacity(byte_count);
    bounded_reader
        .read_to_end(&mut raw_request)
        .map_err(StartupPayloadReadError::Read)?;
    if raw_request.len() != byte_count {
        return Err(StartupPayloadReadError::Read(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            format!(
                "startup payload stdin ended after {} bytes, expected {byte_count}",
                raw_request.len()
            ),
        )));
    }
    Ok(raw_request)
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Read};

    use crate::startup_payload::{StartupPayloadSource, read_startup_payload};

    #[test]
    fn reads_stdin_until_eof() {
        let mut reader = Cursor::new(b"payload".to_vec());

        let payload = read_startup_payload(&mut reader, StartupPayloadSource::StdinUntilEof)
            .expect("payload should read");

        assert_eq!(payload, b"payload");
    }

    #[test]
    fn reads_exact_stdin_byte_count_without_requiring_eof() {
        let mut reader = Cursor::new(b"payload-trailing".to_vec());

        let payload = read_startup_payload(&mut reader, StartupPayloadSource::StdinBytes(7))
            .expect("payload should read");

        assert_eq!(payload, b"payload");
        let mut trailing = Vec::new();
        reader
            .read_to_end(&mut trailing)
            .expect("trailing bytes should remain readable");
        assert_eq!(trailing, b"-trailing");
    }

    #[test]
    fn fails_when_exact_stdin_byte_count_is_not_available() {
        let mut reader = Cursor::new(b"short".to_vec());

        let error = read_startup_payload(&mut reader, StartupPayloadSource::StdinBytes(6))
            .expect_err("short payload should fail");

        assert_eq!(
            error.to_string(),
            "startup payload stdin ended after 5 bytes, expected 6"
        );
    }
}
