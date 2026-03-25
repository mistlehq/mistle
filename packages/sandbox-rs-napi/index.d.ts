export declare class NativePtySession {
  resize(cols: number, rows: number): void;
  write(data: Buffer): void;
  terminate(): Promise<number>;
}

export declare class NativeManagedProcess {
  signal(signal: "sigterm" | "sigkill"): void;
  hasExited(): boolean;
}

export declare class NativePreparedProxyCaRuntimeEnv {
  readonly certificateFd: number;
  readonly privateKeyFd: number;
  cleanup(): void;
}

export interface GeneratedProxyCaResult {
  certificatePem: string;
  privateKeyPem: string;
}

export interface PrepareProxyCaRuntimeEnvInput {
  certificatePem: string;
  privateKeyPem: string;
}

export interface IssueProxyLeafCertificateInput {
  caCertificatePem: string;
  caPrivateKeyPem: string;
  serverName: string;
}

export interface IssuedProxyLeafCertificateResult {
  certificateChainPem: string;
  privateKeyPem: string;
}

export interface UnixSocketPeerCredentials {
  pid: number;
  uid: number;
  gid: number;
}

export interface PtyEnvironmentEntry {
  name: string;
  value: string;
}

export interface ProcessEnvironmentEntry {
  name: string;
  value: string;
}

export interface SpawnPtyInput {
  command: string;
  args: string[];
  cwd?: string;
  env?: PtyEnvironmentEntry[];
  cols?: number;
  rows?: number;
}

export interface ExecRuntimeAsUserInput {
  uid: number;
  gid: number;
  command: string;
  args: string[];
  env: ProcessEnvironmentEntry[];
}

export interface SpawnManagedProcessInput {
  command: string;
  args: string[];
  cwd?: string;
  env?: ProcessEnvironmentEntry[];
}

export interface ProcessExitResult {
  exitCode?: number;
  signal?: string;
}

export interface PtyEventResult {
  kind: string;
  data?: Uint8Array;
  exitCode?: number;
  message?: string;
}

export declare function generateProxyCa(): GeneratedProxyCaResult;
export declare function prepareProxyCaRuntime(
  input: PrepareProxyCaRuntimeEnvInput,
): NativePreparedProxyCaRuntimeEnv;
export declare function issueProxyLeafCertificate(
  input: IssueProxyLeafCertificateInput,
): IssuedProxyLeafCertificateResult;
export declare function getUnixSocketPeerCredentials(
  fd: number,
): UnixSocketPeerCredentials | null | undefined;
export declare function execRuntimeAsUser(input: ExecRuntimeAsUserInput): void;
export declare function setCurrentProcessNonDumpable(): void;
export declare function spawnManagedProcess(
  input: SpawnManagedProcessInput,
  onExit: (result: ProcessExitResult) => void,
): NativeManagedProcess;
export declare function spawnPty(
  input: SpawnPtyInput,
  onEvent: (event: PtyEventResult) => void,
): NativePtySession;
