//! FFF-backed file search stream worker.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration as StdDuration, Instant};

use fff_search::file_picker::FilePicker;
use fff_search::{
    FFFMode, FilePickerOptions, FuzzySearchOptions, MixedItemRef, PaginationArgs, QueryParser,
    SharedFilePicker, SharedFrecency,
};

use crate::tunnel::protocol::{
    FileSearchQuery, FileSearchResultItem, FileSearchResultKind, FileSearchSelect,
};

pub const DEFAULT_FILE_SEARCH_DEBOUNCE_INTERVAL: StdDuration = StdDuration::from_millis(100);
pub const DEFAULT_FILE_SEARCH_LIMIT: usize = 50;
pub const MAX_FILE_SEARCH_LIMIT: usize = 100;
const FILE_SEARCH_SCAN_TIMEOUT: StdDuration = StdDuration::from_secs(10);
const FILE_SEARCH_ERROR_CODE_SEARCH_FAILED: &str = "search_failed";

#[derive(Debug)]
pub enum FileSearchWorkerCommand {
    Query(FileSearchQuery),
    Select(FileSearchSelect),
    Close,
}

#[derive(Debug)]
pub enum FileSearchWorkerEvent {
    Results {
        stream_id: u32,
        request_id: String,
        query: String,
        items: Vec<FileSearchResultItem>,
        metrics: FileSearchQueryMetrics,
    },
    Error {
        stream_id: u32,
        request_id: String,
        code: String,
        message: String,
        metrics: FileSearchQueryMetrics,
    },
}

pub struct FileSearchWorker {
    pub command_sender: mpsc::Sender<FileSearchWorkerCommand>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSearchQueryMetrics {
    pub query_length: usize,
    pub requested_limit: Option<usize>,
    pub effective_limit: usize,
    pub collapsed_query_count: u64,
    pub debounce_wait_ms: u64,
    pub scan_wait_ms: u64,
    pub search_ms: u64,
    pub total_latency_ms: u64,
    pub result_count: usize,
    pub limited: bool,
}

pub fn spawn_file_search_worker<F>(
    stream_id: u32,
    cwd: &str,
    emit_event: F,
) -> Result<FileSearchWorker, String>
where
    F: Fn(FileSearchWorkerEvent) + Send + 'static,
{
    let engine = FileSearchEngine::new(cwd)?;
    let (command_sender, command_receiver) = mpsc::channel();
    thread::spawn(move || run_file_search_worker(stream_id, engine, command_receiver, emit_event));
    Ok(FileSearchWorker { command_sender })
}

fn run_file_search_worker<F>(
    stream_id: u32,
    engine: FileSearchEngine,
    command_receiver: mpsc::Receiver<FileSearchWorkerCommand>,
    emit_event: F,
) where
    F: Fn(FileSearchWorkerEvent),
{
    while let Ok(command) = command_receiver.recv() {
        let query = match command {
            FileSearchWorkerCommand::Query(query) => query,
            FileSearchWorkerCommand::Select(selection) => {
                let _ = selection.path;
                continue;
            }
            FileSearchWorkerCommand::Close => break,
        };
        let Some(debounced_query) = latest_debounced_query(
            &command_receiver,
            query,
            DEFAULT_FILE_SEARCH_DEBOUNCE_INTERVAL,
        ) else {
            break;
        };
        emit_event(match engine.search(&debounced_query.query) {
            Ok(search_result) => FileSearchWorkerEvent::Results {
                stream_id,
                request_id: debounced_query.query.request_id.clone(),
                query: debounced_query.query.query.clone(),
                items: search_result.items,
                metrics: search_result.metrics.with_debounce(&debounced_query),
            },
            Err(message) => FileSearchWorkerEvent::Error {
                stream_id,
                request_id: debounced_query.query.request_id.clone(),
                code: FILE_SEARCH_ERROR_CODE_SEARCH_FAILED.to_string(),
                message,
                metrics: FileSearchQueryMetrics {
                    query_length: debounced_query.query.query.len(),
                    requested_limit: debounced_query.query.limit,
                    effective_limit: requested_limit(&debounced_query.query),
                    collapsed_query_count: debounced_query.collapsed_query_count,
                    debounce_wait_ms: duration_millis_u64(debounced_query.debounce_wait),
                    scan_wait_ms: 0,
                    search_ms: 0,
                    total_latency_ms: duration_millis_u64(debounced_query.started_at.elapsed()),
                    result_count: 0,
                    limited: false,
                },
            },
        });
    }
}

struct DebouncedFileSearchQuery {
    query: FileSearchQuery,
    started_at: Instant,
    debounce_wait: StdDuration,
    collapsed_query_count: u64,
}

fn latest_debounced_query(
    command_receiver: &mpsc::Receiver<FileSearchWorkerCommand>,
    first_query: FileSearchQuery,
    debounce_interval: StdDuration,
) -> Option<DebouncedFileSearchQuery> {
    let started_at = Instant::now();
    let mut latest_query = first_query;
    let mut collapsed_query_count = 0;
    loop {
        match command_receiver.recv_timeout(debounce_interval) {
            Ok(FileSearchWorkerCommand::Query(query)) => {
                latest_query = query;
                collapsed_query_count += 1;
            }
            Ok(FileSearchWorkerCommand::Select(selection)) => {
                let _ = selection.path;
                continue;
            }
            Ok(FileSearchWorkerCommand::Close) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                return None;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Some(DebouncedFileSearchQuery {
                    query: latest_query,
                    started_at,
                    debounce_wait: started_at.elapsed(),
                    collapsed_query_count,
                });
            }
        }
    }
}

struct FileSearchEngine {
    base_path: PathBuf,
    shared_picker: SharedFilePicker,
}

struct FileSearchResult {
    items: Vec<FileSearchResultItem>,
    metrics: FileSearchQueryMetrics,
}

impl FileSearchEngine {
    fn new(cwd: &str) -> Result<Self, String> {
        let base_path = canonical_search_root(cwd)?;
        let shared_picker = SharedFilePicker::default();
        FilePicker::new_with_shared_state(
            shared_picker.clone(),
            SharedFrecency::default(),
            FilePickerOptions {
                base_path: base_path.to_string_lossy().into_owned(),
                mode: FFFMode::Ai,
                ..Default::default()
            },
        )
        .map_err(|error| format!("failed to initialize file search index: {error}"))?;

        Ok(Self {
            base_path,
            shared_picker,
        })
    }

    fn search(&self, query: &FileSearchQuery) -> Result<FileSearchResult, String> {
        let total_started_at = Instant::now();
        let scan_started_at = Instant::now();
        if !self.shared_picker.wait_for_scan(FILE_SEARCH_SCAN_TIMEOUT) {
            return Err(format!(
                "file search index scan timed out for {}",
                self.base_path.display()
            ));
        }
        let scan_wait = scan_started_at.elapsed();

        let search_started_at = Instant::now();
        let picker_guard = self
            .shared_picker
            .read()
            .map_err(|error| format!("failed to read file search index: {error}"))?;
        let picker = picker_guard
            .as_ref()
            .ok_or_else(|| "file search index is not initialized".to_string())?;
        let parser = QueryParser::default();
        let parsed_query = parser.parse(&query.query);
        let results = picker.fuzzy_search_mixed(
            &parsed_query,
            None,
            FuzzySearchOptions {
                max_threads: 0,
                current_file: None,
                project_path: Some(&self.base_path),
                pagination: PaginationArgs {
                    offset: 0,
                    limit: requested_limit(query),
                },
                ..Default::default()
            },
        );
        let total_matched = results.total_matched;

        let items = results
            .items
            .into_iter()
            .map(|item| match item {
                MixedItemRef::File(file) => FileSearchResultItem {
                    path: file.relative_path(picker),
                    kind: FileSearchResultKind::File,
                },
                MixedItemRef::Dir(directory) => FileSearchResultItem {
                    path: directory.relative_path(picker),
                    kind: FileSearchResultKind::Directory,
                },
            })
            .collect::<Vec<_>>();
        let effective_limit = requested_limit(query);
        let result_count = items.len();

        Ok(FileSearchResult {
            items,
            metrics: FileSearchQueryMetrics {
                query_length: query.query.len(),
                requested_limit: query.limit,
                effective_limit,
                collapsed_query_count: 0,
                debounce_wait_ms: 0,
                scan_wait_ms: duration_millis_u64(scan_wait),
                search_ms: duration_millis_u64(search_started_at.elapsed()),
                total_latency_ms: duration_millis_u64(total_started_at.elapsed()),
                result_count,
                limited: total_matched > result_count || result_count >= effective_limit,
            },
        })
    }
}

impl FileSearchQueryMetrics {
    fn with_debounce(mut self, debounced_query: &DebouncedFileSearchQuery) -> Self {
        self.collapsed_query_count = debounced_query.collapsed_query_count;
        self.debounce_wait_ms = duration_millis_u64(debounced_query.debounce_wait);
        self.total_latency_ms = duration_millis_u64(debounced_query.started_at.elapsed());
        self
    }
}

fn requested_limit(query: &FileSearchQuery) -> usize {
    query
        .limit
        .unwrap_or(DEFAULT_FILE_SEARCH_LIMIT)
        .min(MAX_FILE_SEARCH_LIMIT)
}

fn canonical_search_root(cwd: &str) -> Result<PathBuf, String> {
    let path = Path::new(cwd);
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| format!("failed to resolve file search cwd {cwd}: {error}"))?;
    if !canonical_path.is_dir() {
        return Err(format!(
            "file search cwd {} is not a directory",
            canonical_path.display()
        ));
    }
    Ok(canonical_path)
}

fn duration_millis_u64(duration: StdDuration) -> u64 {
    let millis = duration.as_millis();
    if millis > u128::from(u64::MAX) {
        u64::MAX
    } else {
        millis as u64
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration as StdDuration;

    use tempfile::TempDir;

    use crate::tunnel::file_search::{
        FileSearchEngine, FileSearchWorkerCommand, MAX_FILE_SEARCH_LIMIT, latest_debounced_query,
        requested_limit,
    };
    use crate::tunnel::protocol::{FileSearchQuery, FileSearchResultKind};

    #[test]
    fn search_returns_matching_files_and_directories_from_cwd() {
        let temp_dir = TempDir::new().expect("temp dir should be created");
        fs::create_dir(temp_dir.path().join("src")).expect("src directory should be created");
        fs::write(temp_dir.path().join("src").join("protocol.rs"), "")
            .expect("protocol file should be written");
        fs::write(temp_dir.path().join("README.md"), "").expect("readme should be written");

        let engine = FileSearchEngine::new(
            temp_dir
                .path()
                .to_str()
                .expect("temp path should be valid utf-8"),
        )
        .expect("file search engine should initialize");
        let file_items = engine
            .search(&file_search_query("request_1", "protocol", Some(10)))
            .expect("file search should succeed");
        let directory_items = engine
            .search(&file_search_query("request_2", "src/", Some(10)))
            .expect("directory search should succeed");

        assert!(file_items.items.iter().any(|item| {
            item.path == "src/protocol.rs" && matches!(item.kind, FileSearchResultKind::File)
        }));
        assert!(directory_items.items.iter().any(|item| {
            item.path.trim_end_matches('/') == "src"
                && matches!(item.kind, FileSearchResultKind::Directory)
        }));
    }

    #[test]
    fn requested_limit_never_exceeds_the_hard_limit() {
        assert_eq!(
            requested_limit(&file_search_query(
                "request_1",
                "protocol",
                Some(MAX_FILE_SEARCH_LIMIT + 1),
            )),
            MAX_FILE_SEARCH_LIMIT,
        );
    }

    #[test]
    fn debounce_uses_the_latest_query_received_before_the_interval_expires() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(FileSearchWorkerCommand::Query(file_search_query(
                "request_2",
                "second",
                None,
            )))
            .expect("second query should send");

        let latest = latest_debounced_query(
            &receiver,
            file_search_query("request_1", "first", None),
            StdDuration::from_millis(1),
        )
        .expect("debounced query should be returned");

        assert_eq!(latest.query.request_id, "request_2");
        assert_eq!(latest.query.query, "second");
    }

    fn file_search_query(request_id: &str, query: &str, limit: Option<usize>) -> FileSearchQuery {
        FileSearchQuery {
            message_type: "fileSearch.query".to_string(),
            request_id: request_id.to_string(),
            query: query.to_string(),
            limit,
        }
    }
}
