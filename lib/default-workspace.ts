import { homedir } from "os";
import { join } from "path";

/**
 * Absolute path to the deployment's default workspace.
 *
 * PI_WEB_DEFAULT_WORKSPACE is the workspace subdirectory under JUMPERPEDIA_HOME
 * (e.g. "Quicknotes/sonar"). Both fall back to the plain Quicknotes dir so an
 * unconfigured deployment behaves as it did before these vars existed.
 *
 * Kept in one place so /api/home, /api/default-cwd and the sidebar's pinned
 * project list cannot drift apart.
 */
export function resolveDefaultWorkspace(): string {
  const jumperpediaHome = process.env.JUMPERPEDIA_HOME || join(homedir(), "HalfaCloud", "Jumperpedia");
  const workspace = process.env.PI_WEB_DEFAULT_WORKSPACE || "Quicknotes";
  return join(jumperpediaHome, workspace);
}

/**
 * When true, a fresh page load with no session restored from the URL lands in the
 * default workspace instead of the most recently active project. Off unless
 * PI_WEB_DEFAULT_ON_LOAD=1, so upstream "last used wins" behavior is preserved
 * for deployments that don't opt in.
 */
export function defaultWorkspaceOnLoad(): boolean {
  return process.env.PI_WEB_DEFAULT_ON_LOAD === "1";
}
