export type RuntimeEnv = {
  isDevelopment: boolean;
};

export function getRuntimeEnv(): RuntimeEnv {
  return {
    isDevelopment: import.meta.env.DEV,
  };
}
