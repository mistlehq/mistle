import {
  compileGitHubApiKeyBinding,
  type GitHubCompileBindingInput,
} from "../../shared/compile-binding.js";

export type GitHubCloudCompileBindingInput = GitHubCompileBindingInput;

export const compileGitHubCloudBinding = compileGitHubApiKeyBinding;
