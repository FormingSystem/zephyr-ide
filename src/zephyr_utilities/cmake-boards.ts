// SPDX-License-Identifier: Apache-2.0
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import { parseCMakeCache } from "../build_data/build-artifact-reader";
import { getModuleYamlFile } from "../setup_utilities/modules";
import { toolEnvironment } from "../setup_utilities/tool-environment";
import type { SetupState } from "../setup_utilities/types";
import { pythonInVenv } from "../utilities/python-venv";
import { getEffectiveZephyrBase } from "../utilities/utils";
import { cmakeDefinitions, type CMakeLocation } from "./direct-cmake";

const inspect = promisify(execFile);
const boardScript = path.join("scripts", "list_boards.py");
const hardwareRoots = ["BOARD_ROOT", "SOC_ROOT", "ARCH_ROOT"] as const;

function enclosingZephyr(source: string): string | undefined {
  for (let dir = path.resolve(source); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, boardScript))) { return dir; }
    if (path.dirname(dir) === dir) { return; }
  }
}

export function boardTargets(output: string): string[] {
  const boards = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const fields = /^NAME;([^|]+)\|QUALIFIERS;([^|]*)\|REVISIONS;(.*)$/.exec(line);
    if (!fields) { continue; }
    const [, name, qualifiers, revisions] = fields;
    for (const revision of ["", ...revisions.split(";").filter(Boolean)]) {
      for (const qualifier of qualifiers.split(";")) {
        boards.add(name + (revision && "@" + revision) + (qualifier && "/" + qualifier));
      }
    }
  }
  return [...boards].sort();
}

function boardRootArguments(location: CMakeLocation, base: string, config: Record<string, string | undefined>) {
  const generated = path.join(location.binary, "zephyr_settings.txt");
  const entries = fs.existsSync(generated) ? fs.readFileSync(generated, "utf8").split(/\r?\n/) : [];
  const modules = [config.ZEPHYR_MODULES, config.EXTRA_ZEPHYR_MODULES, config.ZEPHYR_EXTRA_MODULES]
    .flatMap(list => list?.split(";").filter(Boolean) ?? [])
    .map(item => path.resolve(location.source, item))
    .map(dir => ({ dir, settings: getModuleYamlFile(dir)?.build?.settings }));
  return hardwareRoots.flatMap(key => {
    const roots = new Set([base, location.source]);
    for (const item of config[key]?.split(";").filter(Boolean) ?? []) { roots.add(path.resolve(location.source, item)); }
    for (const line of entries) {
      const match = /^"([^"]+)":"(.+)"$/.exec(line.trim());
      if (match?.[1] === key) { roots.add(path.resolve(location.source, match[2])); }
    }
    for (const { dir, settings } of modules) {
      const relative = settings?.[key.toLowerCase()];
      if (typeof relative === "string") { roots.add(path.resolve(dir, relative)); }
    }
    return [...roots].flatMap(dir => ["--" + key.toLowerCase().replace("_", "-"), dir]);
  });
}

export async function listCMakeBoards(location: CMakeLocation, definitions: string, setup?: SetupState) {
  const env = toolEnvironment();
  const config = { ...env, ...parseCMakeCache(location.binary) };
  for (const arg of cmakeDefinitions(definitions)) {
    const split = arg.indexOf("=");
    config[arg.slice(2, split).split(":")[0]] = arg.slice(split + 1);
  }
  const source = config.ZEPHYR_BASE || enclosingZephyr(location.source) || (setup && getEffectiveZephyrBase(setup));
  const base = source && path.resolve(location.source, source);
  if (!base || !fs.existsSync(path.join(base, boardScript))) {
    throw Error(vscode.l10n.t("Choose the local Zephyr source directory containing scripts/list_boards.py."));
  }
  const venvs = [env.VIRTUAL_ENV, setup?.env.VIRTUAL_ENV, path.join(base, ".venv"), path.join(path.dirname(base), ".venv")];
  const python = config.Python3_EXECUTABLE || config._Python3_EXECUTABLE || config.PYTHON_EXECUTABLE ||
    venvs.flatMap(dir => dir ? [pythonInVenv(dir)] : []).find(p => fs.existsSync(p)) || (process.platform === "win32" ? "python" : "python3");
  const args = [path.join(base, boardScript), "--cmakeformat", "{NAME}|{QUALIFIERS}|{REVISIONS}", ...boardRootArguments(location, base, config)];
  const { stdout } = await inspect(python, args, { cwd: location.source, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return boardTargets(stdout);
}
