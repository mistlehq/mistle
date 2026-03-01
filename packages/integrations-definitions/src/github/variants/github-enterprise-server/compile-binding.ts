import {
  compileGitHubApiKeyBinding,
  type GitHubCompileBindingInput,
} from "../../shared/compile-binding.js";

export type GitHubEnterpriseServerCompileBindingInput = GitHubCompileBindingInput;

export const compileGitHubEnterpriseServerBinding = compileGitHubApiKeyBinding;
