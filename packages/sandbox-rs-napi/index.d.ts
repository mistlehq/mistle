export declare class NativePtySession {
  resize(cols: number, rows: number): void;
  write(data: Buffer): void;
  terminate(): Promise<number>;
}

export interface GeneratedProxyCaResult {
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

export interface PtyEnvironmentEntry {
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

export interface PtyEventResult {
  kind: string;
  data?: Uint8Array;
  exitCode?: number;
  message?: string;
}

export declare function generateProxyCa(): GeneratedProxyCaResult;
export declare function issueProxyLeafCertificate(
  input: IssueProxyLeafCertificateInput,
): IssuedProxyLeafCertificateResult;
export declare function spawnPty(
  input: SpawnPtyInput,
  onEvent: (event: PtyEventResult) => void,
): NativePtySession;
