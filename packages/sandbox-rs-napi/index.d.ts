export declare function generateProxyCa(): {
  certificatePem: string;
  privateKeyPem: string;
};
export declare function issueProxyLeafCertificate(input: {
  caCertificatePem: string;
  caPrivateKeyPem: string;
  serverName: string;
}): {
  certificateChainPem: string;
  privateKeyPem: string;
};
