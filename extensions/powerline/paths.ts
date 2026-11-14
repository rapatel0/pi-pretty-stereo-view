import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "../integrated/ui-runtime.js";

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function getAgentPath(...segments: string[]): string {
  return join(getAgentDir(), ...segments);
}
