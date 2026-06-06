package idempotency

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
)

const DefaultStoreDir = "/var/lib/mistle/sandboxd/idempotency"

var tempFileCounter uint64

type Store struct {
	root    string
	records map[storeKey]IdempotencyRecord
}

func LoadDefaultStore() (*Store, error) {
	return LoadStore(DefaultStoreDir)
}

func LoadStore(root string) (*Store, error) {
	if err := prepareStoreDirectory(root); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("failed to read idempotency store directory %q: %w", root, err)
	}
	store := &Store{
		root:    root,
		records: map[storeKey]IdempotencyRecord{},
	}
	for _, entry := range entries {
		path := filepath.Join(root, entry.Name())
		fileType, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("failed to read idempotency store directory entry %q: %w", path, err)
		}
		if !fileType.Mode().IsRegular() {
			return nil, fmt.Errorf("unexpected idempotency store directory entry %q", path)
		}
		if isStoreTempRecordFileName(entry.Name()) {
			if err := os.Remove(path); err != nil {
				return nil, fmt.Errorf("failed to remove temporary idempotency record %q: %w", path, err)
			}
			continue
		}
		if filepath.Ext(entry.Name()) != ".json" {
			return nil, fmt.Errorf("unexpected idempotency store directory entry %q", path)
		}
		record, err := loadRecord(path)
		if err != nil {
			return nil, err
		}
		expectedPath := recordPath(root, record.RuntimeID, record.Operation, record.Key)
		if path != expectedPath {
			return nil, fmt.Errorf("idempotency record %q belongs at %q", path, expectedPath)
		}
		key := keyFromRecord(record)
		if _, ok := store.records[key]; ok {
			return nil, fmt.Errorf("duplicate idempotency record for runtime %s, operation %s, and key %q", key.RuntimeID, key.Operation, key.Key)
		}
		store.records[key] = record
	}
	return store, nil
}

func (store *Store) StartOperation(input StartOperation) (IdempotencyRecord, error) {
	key := storeKey{RuntimeID: input.RuntimeID, Operation: input.Operation, Key: input.Key}
	if existing, ok := store.records[key]; ok {
		if _, err := existing.ClassifyRepeatedRequest(input.RequestFingerprint); err != nil {
			return IdempotencyRecord{}, err
		}
		return existing, nil
	}
	return store.writeAndIndexRecord(StartedRecord(input))
}

func (store *Store) MarkAccepted(runtimeID AgentRuntimeID, operation IdempotencyOperation, key string, input AcceptOperation) (IdempotencyRecord, error) {
	existing, err := store.GetByKey(runtimeID, operation, key)
	if err != nil {
		return IdempotencyRecord{}, err
	}
	record, err := existing.MarkAccepted(input)
	if err != nil {
		return IdempotencyRecord{}, err
	}
	return store.writeAndIndexRecord(record)
}

func (store *Store) MarkCompleted(runtimeID AgentRuntimeID, operation IdempotencyOperation, key string, input CompleteOperation) (IdempotencyRecord, error) {
	existing, err := store.GetByKey(runtimeID, operation, key)
	if err != nil {
		return IdempotencyRecord{}, err
	}
	record, err := existing.MarkCompleted(input)
	if err != nil {
		return IdempotencyRecord{}, err
	}
	return store.writeAndIndexRecord(record)
}

func (store *Store) DeleteStarted(runtimeID AgentRuntimeID, operation IdempotencyOperation, key string, requestFingerprint RequestFingerprint) error {
	record, err := store.GetByKey(runtimeID, operation, key)
	if err != nil {
		return err
	}
	if _, err := record.ClassifyRepeatedRequest(requestFingerprint); err != nil {
		return err
	}
	if record.Status != IdempotencyRecordStarted {
		return InvalidTransitionError{From: record.Status, To: IdempotencyRecordStarted}
	}
	path := store.RecordPath(runtimeID, operation, key)
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("failed to delete idempotency record %q: %w", path, err)
	}
	delete(store.records, storeKey{RuntimeID: runtimeID, Operation: operation, Key: key})
	return syncDirectory(store.root)
}

func (store *Store) GetByKey(runtimeID AgentRuntimeID, operation IdempotencyOperation, key string) (IdempotencyRecord, error) {
	storeKey := storeKey{RuntimeID: runtimeID, Operation: operation, Key: key}
	record, ok := store.records[storeKey]
	if !ok {
		return IdempotencyRecord{}, MissingRecordError{RuntimeID: runtimeID, Operation: operation, Key: key}
	}
	return record, nil
}

func (store *Store) RecordPath(runtimeID AgentRuntimeID, operation IdempotencyOperation, key string) string {
	return recordPath(store.root, runtimeID, operation, key)
}

func (store *Store) Root() string {
	return store.root
}

func (store *Store) writeAndIndexRecord(record IdempotencyRecord) (IdempotencyRecord, error) {
	path := store.RecordPath(record.RuntimeID, record.Operation, record.Key)
	if err := writeRecordAtomically(store.root, path, record); err != nil {
		return IdempotencyRecord{}, err
	}
	store.records[keyFromRecord(record)] = record
	return record, nil
}

type storeKey struct {
	RuntimeID AgentRuntimeID
	Operation IdempotencyOperation
	Key       string
}

func keyFromRecord(record IdempotencyRecord) storeKey {
	return storeKey{RuntimeID: record.RuntimeID, Operation: record.Operation, Key: record.Key}
}

type MissingRecordError struct {
	RuntimeID AgentRuntimeID
	Operation IdempotencyOperation
	Key       string
}

func (err MissingRecordError) Error() string {
	return fmt.Sprintf("missing idempotency record for runtime %s, operation %s, and key %q", err.RuntimeID, err.Operation, err.Key)
}

func loadRecord(path string) (IdempotencyRecord, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return IdempotencyRecord{}, fmt.Errorf("failed to read idempotency record %q: %w", path, err)
	}
	var record IdempotencyRecord
	if err := json.Unmarshal(contents, &record); err != nil {
		return IdempotencyRecord{}, fmt.Errorf("failed to decode idempotency record %q: %w", path, err)
	}
	if record.Version != CurrentIdempotencyRecordVersion {
		return IdempotencyRecord{}, fmt.Errorf("unsupported idempotency record version %d in %q (supported version: %d)", record.Version, path, CurrentIdempotencyRecordVersion)
	}
	return record, nil
}

func prepareStoreDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return fmt.Errorf("failed to create idempotency store directory %q: %w", path, err)
	}
	metadata, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("failed to read idempotency store directory %q: %w", path, err)
	}
	if !metadata.IsDir() {
		return fmt.Errorf("idempotency store root %q is not a directory", path)
	}
	return nil
}

func writeRecordAtomically(root string, finalPath string, record IdempotencyRecord) error {
	if err := prepareStoreDirectory(root); err != nil {
		return err
	}
	contents, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode idempotency record for key %q: %w", record.Key, err)
	}
	contents = append(contents, '\n')
	tempPath := temporaryRecordPath(root, record.RuntimeID, record.Operation, record.Key)
	if err := writeTempRecord(tempPath, contents); err != nil {
		return err
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return fmt.Errorf("failed to rename temporary idempotency record %q to %q: %w", tempPath, finalPath, err)
	}
	return syncDirectory(root)
}

func writeTempRecord(path string, contents []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("failed to create temporary idempotency record %q: %w", path, err)
	}
	defer file.Close()
	if _, err := file.Write(contents); err != nil {
		return fmt.Errorf("failed to write temporary idempotency record %q: %w", path, err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("failed to sync temporary idempotency record %q: %w", path, err)
	}
	return nil
}

func syncDirectory(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("failed to sync idempotency store directory %q: %w", path, err)
	}
	defer file.Close()
	if err := file.Sync(); err != nil {
		return fmt.Errorf("failed to sync idempotency store directory %q: %w", path, err)
	}
	return nil
}

func recordPath(root string, runtimeID AgentRuntimeID, operation IdempotencyOperation, key string) string {
	return filepath.Join(root, recordFileName(runtimeID, operation, key))
}

func recordFileName(runtimeID AgentRuntimeID, operation IdempotencyOperation, key string) string {
	return recordFileStem(runtimeID, operation, key) + ".json"
}

func temporaryRecordPath(root string, runtimeID AgentRuntimeID, operation IdempotencyOperation, key string) string {
	counter := atomic.AddUint64(&tempFileCounter, 1) - 1
	return filepath.Join(root, fmt.Sprintf(".%s.%d.tmp", recordFileStem(runtimeID, operation, key), counter))
}

func recordFileStem(runtimeID AgentRuntimeID, operation IdempotencyOperation, key string) string {
	digest := sha256.Sum256([]byte(key))
	return fmt.Sprintf("%s-%s-%s", runtimeFilePrefix(runtimeID), operationFilePrefix(operation), hex.EncodeToString(digest[:]))
}

func runtimeFilePrefix(runtimeID AgentRuntimeID) string {
	switch runtimeID {
	case AgentRuntimeCodex:
		return "codex"
	case AgentRuntimeOpenCode:
		return "opencode"
	case AgentRuntimePi:
		return "pi"
	default:
		return string(runtimeID)
	}
}

func operationFilePrefix(operation IdempotencyOperation) string {
	switch operation {
	case IdempotencyOperationCreateConversation:
		return "create-conversation"
	case IdempotencyOperationSubmitPayload:
		return "submit-payload"
	default:
		return string(operation)
	}
}

func isStoreTempRecordFileName(fileName string) bool {
	withoutDot, ok := strings.CutPrefix(fileName, ".")
	if !ok {
		return false
	}
	withoutSuffix, ok := strings.CutSuffix(withoutDot, ".tmp")
	if !ok {
		return false
	}
	index := strings.LastIndex(withoutSuffix, ".")
	if index < 0 {
		return false
	}
	recordStem := withoutSuffix[:index]
	counter := withoutSuffix[index+1:]
	if recordStem == "" || counter == "" {
		return false
	}
	if _, err := strconv.ParseUint(counter, 10, 64); err != nil {
		return false
	}
	return isRecordFileStem(recordStem)
}

func isRecordFileStem(stem string) bool {
	runtimeID, rest, ok := strings.Cut(stem, "-")
	if !ok {
		return false
	}
	if runtimeID != "codex" && runtimeID != "opencode" && runtimeID != "pi" {
		return false
	}
	for _, prefix := range []string{"create-conversation-", "submit-payload-"} {
		if suffix, ok := strings.CutPrefix(rest, prefix); ok {
			return isLowerHexSHA256(suffix)
		}
	}
	return false
}

func isLowerHexSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}
