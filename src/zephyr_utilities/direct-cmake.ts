// SPDX-License-Identifier: Apache-2.0
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import { parseCMakeCache } from "../build_data/build-artifact-reader";
import { executeTaskHelper } from "../utilities/utils";
import { toolEnvironment } from "../setup_utilities/tool-environment";

const inspect = promisify(execFile);
const variables = ["BOARD", "BOARD_ROOT", "ZEPHYR_BASE", "ZEPHYR_SDK_INSTALL_DIR", "ZEPHYR_TOOLCHAIN_VARIANT",
  "SOC_ROOT", "ARCH_ROOT", "CROSS_COMPILE", "ZEPHYR_EXTRA_MODULES", "ZEPHYR_MODULES", "EXTRA_ZEPHYR_MODULES", "CONF_FILE", "EXTRA_CONF_FILE", "DTC_OVERLAY_FILE", "EXTRA_DTC_OVERLAY_FILE"];

export interface CMakeLocation {
  source: string;
  binary: string;
}

/** Each non-empty line is one argv element. Spaces inside paths are significant. */
export function cmakeDefinitions(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = /^([A-Za-z_][\w]*(?::[A-Za-z]+)?)\s*=\s*(.*)$/.exec(line);
    if (!match) { throw Error(vscode.l10n.t("Expected NAME=value: {0}", line)); }
    return "-D" + match[1] + "=" + match[2];
  });
}

function hasCMakeApplication(source: string) {
  if (!source) { return false; }
  try {
    return fs.statSync(path.join(source, "CMakeLists.txt"), { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}

function displayDirectory(directory: string) {
  if (!directory) { return ""; }
  const uri = vscode.Uri.file(directory);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder ? path.join(folder.name, path.relative(folder.uri.fsPath, directory)) : directory;
}

function hasGeneratedBuild(binary: string) {
  return fs.existsSync(path.join(binary, "CMakeFiles", "TargetDirectories.txt"));
}

export function describeCMake(location: CMakeLocation) {
  const cache = location.binary ? parseCMakeCache(location.binary) : {};
  const env = toolEnvironment();
  return {
    ...location,
    hasApplication: hasCMakeApplication(location.source),
    sourceLabel: displayDirectory(location.source),
    binaryLabel: displayDirectory(location.binary),
    configured: !!cache.CMAKE_HOME_DIRECTORY && path.relative(cache.CMAKE_HOME_DIRECTORY, location.source) === "" && hasGeneratedBuild(location.binary),
    variables: variables.flatMap(name => {
      if (cache[name]) { return [{ name, value: cache[name], origin: "CMakeCache.txt" }]; }
      return env[name] ? [{ name, value: env[name]!, origin: vscode.l10n.t("Environment") }] : [];
    }),
  };
}

export async function selectCMakeDirectory(source: boolean): Promise<CMakeLocation | string | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    title: source ? vscode.l10n.t("Application directory (CMakeLists.txt)") : vscode.l10n.t("Build directory (CMakeCache.txt)"),
  });
  if (!selected?.length) { return; }
  const dir = selected[0].fsPath;
  if (!source) {
    const cache = parseCMakeCache(dir);
    return cache.CMAKE_HOME_DIRECTORY ? { source: cache.CMAKE_HOME_DIRECTORY, binary: dir } : dir;
  }
  if (!hasCMakeApplication(dir)) { throw Error(vscode.l10n.t("Choose a directory containing CMakeLists.txt.")); }
  return { source: dir, binary: path.join(dir, "build") };
}

function parseTargets(output: string) {
  return output.split(/\r?\n/).flatMap(line => {
    const match = /^(?:\.\.\.\s+([^\s]+)|([^\s:]+):)/.exec(line.trim());
    return match ? [match[1] ?? match[2]] : [];
  });
}

export async function runCMake(location: CMakeLocation, action: string, definitions: string) {
  if (!vscode.workspace.isTrusted || !location.source || !location.binary) { return; }
  const env = toolEnvironment();
  const cache = parseCMakeCache(location.binary);
  const cmake = "cmake";
  let args: string[];
  if (action === "configure") {
    if (!hasCMakeApplication(location.source)) {
      throw Error(vscode.l10n.t("Choose a directory containing CMakeLists.txt."));
    }
    args = ["-S", location.source, "-B", location.binary];
    if (!cache.CMAKE_GENERATOR && !env.CMAKE_GENERATOR) { args.push("-G", "Ninja"); }
    args.push(...cmakeDefinitions(definitions));
  } else {
    if (!cache.CMAKE_HOME_DIRECTORY || !hasGeneratedBuild(location.binary)) { throw Error(vscode.l10n.t("Configure the build directory first.")); }
    if (path.relative(cache.CMAKE_HOME_DIRECTORY, location.source)) {
      throw Error(vscode.l10n.t("This build directory belongs to a different application."));
    }
    args = ["--build", location.binary];
    if (action !== "build") {
      const result = await inspect(cmake, [...args, "--target", "help"], { env, cwd: location.source, windowsHide: true });
      const targets = parseTargets(result.stdout);
      const target = action === "target" ? await vscode.window.showQuickPick(targets, { title: "cmake --build --target" }) : action;
      if (!target) { return; }
      if (!targets.includes(target)) { throw Error(vscode.l10n.t("This build does not provide the {0} target.", target)); }
      args.push("--target", target);
    }
  }
  return executeTaskHelper("Zephyr IDE: CMake", [cmake, ...args], location.source);
}
