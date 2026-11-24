// SPDX-License-Identifier: Apache-2.0
import * as path from "path";
import { pathToFileURL } from "url";
import * as vscode from "vscode";

const environmentKeys = [
  "ZEPHYR_BASE", "ZEPHYR_SDK_INSTALL_DIR", "ZEPHYR_TOOLCHAIN_VARIANT", "CROSS_COMPILE",
  "PATH", "PIP_FIND_LINKS", "PIP_INDEX_URL", "PIP_NO_INDEX", "GIT_ALLOW_PROTOCOL", "GIT_CONFIG_GLOBAL",
] as const;

export function localToolEnvironment(): NodeJS.ProcessEnv {
  const saved = vscode.workspace.getConfiguration("zephyr-ide").get<Record<string, string>>("toolEnvironment", {});
  return Object.fromEntries(environmentKeys.filter(key => typeof saved[key] === "string" && saved[key].trim())
    .map(key => [key, saved[key].trim()]));
}

/** Apply machine-specific tool locations to children only. Keep inherited tools on PATH. */
export function toolEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { PATH: directories, ...values } = localToolEnvironment();
  const env = { ...base, ...values };
  if (directories) {
    const key = Object.keys(env).find(name => process.platform === "win32" && name.toLowerCase() === "path") ?? "PATH";
    env[key] = [directories, env[key] ?? process.env.PATH].filter(Boolean).join(path.delimiter);
  }
  return env;
}

/** Configure one standard variable without writing host paths to shared project settings. */
export async function chooseToolEnvironment() {
  const config = vscode.workspace.getConfiguration("zephyr-ide");
  const saved = localToolEnvironment();
  const items = environmentKeys.map(key => ({
    label: key,
    description: key === "PIP_INDEX_URL" ? undefined : saved[key] ?? process.env[key],
  }));
  const choice = await vscode.window.showQuickPick(items, { title: vscode.l10n.t("Local tool environment") });
  if (!choice) { return; }
  const key = choice.label;
  const value = await vscode.window.showInputBox({
    title: key,
    prompt: vscode.l10n.t("Set this variable for extension commands. Clear it to inherit the environment."),
    value: saved[key] ?? "",
    password: key === "PIP_INDEX_URL",
    placeHolder: key === "PIP_NO_INDEX" ? "1" : key === "GIT_ALLOW_PROTOCOL" ? "file" : undefined,
  });
  if (value === undefined) { return; }
  const trimmed = value.trim();
  if (trimmed) {
    saved[key] = key === "PIP_FIND_LINKS" && path.isAbsolute(trimmed) ? pathToFileURL(trimmed).href : trimmed;
  } else {
    delete saved[key];
  }
  await config.update("toolEnvironment", saved, vscode.ConfigurationTarget.Global);
}
