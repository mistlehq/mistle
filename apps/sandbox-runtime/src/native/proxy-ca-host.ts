import { prepareProxyCaRuntime } from "@mistle/sandbox-rs-napi";

type ProxyCaPayload = {
  certificatePem: string;
  privateKeyPem: string;
};

export function prepareNativeProxyCaRuntimeEnv(proxyCa: ProxyCaPayload): {
  certFd: number;
  keyFd: number;
  cleanup: () => void;
} {
  const preparedEnv = prepareProxyCaRuntime({
    certificatePem: proxyCa.certificatePem,
    privateKeyPem: proxyCa.privateKeyPem,
  });

  return {
    certFd: preparedEnv.certificateFd,
    keyFd: preparedEnv.privateKeyFd,
    cleanup: () => {
      preparedEnv.cleanup();
    },
  };
}
