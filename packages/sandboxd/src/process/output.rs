//! Bounded stdout/stderr capture for runtime client processes.
//!
//! Process start and health errors include recent output so callers get useful
//! diagnostics without retaining unbounded child logs in memory.

use std::collections::VecDeque;
use std::io::Read;
use std::thread::{self, JoinHandle};

use crate::process::*;

impl ProcessOutputCapture {
    pub(super) fn new() -> Self {
        Self {
            stdout: Arc::new(Mutex::new(TailBuffer::new(4 * 1024))),
            stderr: Arc::new(Mutex::new(TailBuffer::new(8 * 1024))),
            capture_threads: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(super) fn record_stdout(&self, bytes: &[u8]) {
        self.stdout
            .lock()
            .expect("stdout tail buffer lock should not be poisoned")
            .append(bytes);
    }

    pub(super) fn record_stderr(&self, bytes: &[u8]) {
        self.stderr
            .lock()
            .expect("stderr tail buffer lock should not be poisoned")
            .append(bytes);
    }

    pub(super) fn stdout_tail(&self) -> Option<String> {
        self.stdout
            .lock()
            .expect("stdout tail buffer lock should not be poisoned")
            .snapshot()
    }

    pub(super) fn stderr_tail(&self) -> Option<String> {
        self.stderr
            .lock()
            .expect("stderr tail buffer lock should not be poisoned")
            .snapshot()
    }

    pub(super) fn register_capture_thread(&self, capture_thread: JoinHandle<()>) {
        self.capture_threads
            .lock()
            .expect("capture thread list lock should not be poisoned")
            .push(capture_thread);
    }

    pub(super) fn finish_capture_threads(&self) {
        let capture_threads = {
            let mut capture_threads = self
                .capture_threads
                .lock()
                .expect("capture thread list lock should not be poisoned");
            std::mem::take(&mut *capture_threads)
        };

        for capture_thread in capture_threads {
            let _ = capture_thread.join();
        }
    }

    pub(super) fn collect_tails_after_process_exit(&self) -> ProcessOutputTails {
        self.finish_capture_threads();

        let stdout_tail = self.stdout_tail();
        let stderr_tail = self.stderr_tail();
        ProcessOutputTails {
            stdout_captured: stdout_tail.is_some(),
            stderr_captured: stderr_tail.is_some(),
            stdout_tail,
            stderr_tail,
        }
    }
}

impl TailBuffer {
    pub(super) fn new(max_bytes: usize) -> Self {
        Self {
            max_bytes,
            bytes: VecDeque::new(),
        }
    }

    pub(super) fn append(&mut self, chunk: &[u8]) {
        for &byte in chunk {
            self.bytes.push_back(byte);
        }
        while self.bytes.len() > self.max_bytes {
            let _ = self.bytes.pop_front();
        }
    }

    pub(super) fn snapshot(&self) -> Option<String> {
        if self.bytes.is_empty() {
            return None;
        }

        let bytes = self.bytes.iter().copied().collect::<Vec<_>>();
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }
}

pub(super) fn spawn_output_capture_thread<R>(
    mut reader: R,
    output_capture: ProcessOutputCapture,
    stream: OutputStream,
) -> JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => match stream {
                    OutputStream::Stdout => output_capture.record_stdout(&buffer[..bytes_read]),
                    OutputStream::Stderr => output_capture.record_stderr(&buffer[..bytes_read]),
                },
                Err(_) => break,
            }
        }
    })
}
