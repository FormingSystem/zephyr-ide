// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "fs";
import { join } from "path";

export function windows7ZipDirectory(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (process.platform !== "win32") { return undefined; }
  for (const base of [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (base && existsSync(join(base, "7-Zip", "7z.exe"))) { return join(base, "7-Zip"); }
  }
  return undefined;
}
