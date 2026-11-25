// SPDX-License-Identifier: Apache-2.0
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  buildEnvFromCMakeCache,
  getKconfigHelperPath,
  KconfigSession,
  resolveDotConfig,
  resolveKconfigRoot,
  resolveVenvPython,
  type KconfigNode,
} from "../../../build_data/kconfig-session";
import { parseCMakeCache, readBuildInfoSourceFiles } from "../../../build_data/build-artifact-reader";
import { resolveEffectiveBuildDir } from "../../../zephyr_utilities/runners-yaml";
import { listCMakeBoards } from "../../../zephyr_utilities/cmake-boards";
import { cmakeDefinitions, type CMakeLocation } from "../../../zephyr_utilities/direct-cmake";
import { toolEnvironment } from "../../../setup_utilities/tool-environment";
import type { SetupState } from "../../../setup_utilities/types";
import { confEntries } from "./documents";
import type { Catalog, GraphOption, Route } from "./types";

export interface GraphContext extends CMakeLocation {
  extension: string;
  setup?: SetupState;
  definitions: string;
}

export function inside(root: string, filename: string) {
  const rel = path.relative(root, filename);
  return !!rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

function projectFiles(ctx: GraphContext, binary: string, device: boolean) {
  const build = readBuildInfoSourceFiles(binary);
  const suffix = device ? ".overlay" : ".conf";
  const fallback = device ? "app.overlay" : "prj.conf";
  const cache = parseCMakeCache(binary);
  for (const arg of cmakeDefinitions(ctx.definitions)) {
    const i = arg.indexOf("=");
    cache[arg.slice(2, i).split(":")[0]] = arg.slice(i + 1);
  }
  const keys = device ? ["DTC_OVERLAY_FILE", "EXTRA_DTC_OVERLAY_FILE"] : ["CONF_FILE", "EXTRA_CONF_FILE"];
  const paths = [...keys.flatMap((k) => cache[k]?.split(";") ?? []), ...(device ? build.dtsFiles : build.kconfigFiles)];
  const files = paths
    .map((p) => path.resolve(ctx.source, p))
    .filter((p) => p.endsWith(suffix) && inside(ctx.source, p) && !inside(binary, p));
  return [...new Set(files.map((p) => path.relative(ctx.source, p)).concat(fallback))];
}

function symbols(node: KconfigNode, group: string, out: Map<string, GraphOption>) {
  if (node.name && node.is_symbol && node.prompt && ["bool", "tristate", "string", "int", "hex"].includes(node.type)) {
    const id = "CONFIG_" + node.name.replace(/^CONFIG_/, "");
    out.set(id, {
      id,
      label: id,
      type: node.type,
      group,
      value: node.value,
      visible: node.visible,
      prompt: node.prompt,
      choices: node.type === "bool" ? ["y", "n"] : node.type === "tristate" ? ["y", "m", "n"] : undefined,
    });
  }
  for (const child of node.children ?? []) {
    symbols(child, node.is_menu && node.prompt ? node.prompt : group, out);
  }
}

function fileSymbols(ctx: GraphContext, files: string[], out: Map<string, GraphOption>) {
  for (const file of files) {
    const target = path.resolve(ctx.source, file);
    if (!fs.existsSync(target) || !inside(fs.realpathSync(ctx.source), fs.realpathSync(target))) {
      continue;
    }
    for (const [id, raw] of confEntries(fs.readFileSync(target, "utf8"))) {
      if (out.has(id)) {
        continue;
      }
      const type = /^[ynm]$/.test(raw) ? "tristate" : /^0x/i.test(raw) ? "hex" : /^-?\d+$/.test(raw) ? "int" : "string";
      let value = raw;
      if (raw.startsWith('"')) {
        try {
          value = JSON.parse(raw);
        } catch {
          /* Keep the spelling visible. */
        }
      }
      out.set(id, {
        id,
        label: id,
        type,
        group: file,
        value,
        choices: type === "tristate" ? ["y", "m", "n"] : undefined,
      });
    }
  }
}

function graphPython(binary: string, ctx: GraphContext) {
  const cache = parseCMakeCache(binary);
  return (
    [cache.Python3_EXECUTABLE, cache._Python3_EXECUTABLE].find((p) => p && fs.existsSync(p)) ||
    resolveVenvPython(ctx.setup)
  );
}

async function kconfig(ctx: GraphContext, binary: string, files: string[]): Promise<Catalog> {
  const env = buildEnvFromCMakeCache(binary);
  const root = resolveKconfigRoot(env);
  const out = new Map<string, GraphOption>();
  let note = "";
  if (root && fs.existsSync(resolveDotConfig(binary))) {
    const python = graphPython(binary, ctx);
    const session = new KconfigSession({
      pythonExecutable: python,
      helperScript: getKconfigHelperPath(ctx.extension),
      spawnEnv: toolEnvironment(),
    });
    try {
      session.start();
      await session.init({ kconfigRoot: root, env, dotConfig: resolveDotConfig(binary) });
      symbols((await session.tree()).top_menu, "Kconfig", out);
    } catch (error) {
      note = String(error);
    } finally {
      session.dispose();
    }
  } else {
    note = vscode.l10n.t("Configure this build to discover additional Kconfig symbols.");
  }
  fileSymbols(ctx, files, out);
  return { route: "kconfig", options: [...out.values()], files, note };
}

export async function readCatalog(ctx: GraphContext, route: Route): Promise<Catalog> {
  if (route === "board") {
    const boards = await listCMakeBoards(ctx, ctx.definitions, ctx.setup);
    return {
      route,
      files: ["CMakePresets.json"],
      options: boards.map((id) => ({ id, label: id, group: id.split("/")[0], type: "board", value: id })),
    };
  }
  const binary = resolveEffectiveBuildDir(ctx.binary);
  const files = projectFiles(ctx, binary, route === "device");
  if (route === "kconfig") {
    return kconfig(ctx, binary, files);
  }
  const dts = path.join(binary, "zephyr", "zephyr.dts");
  if (!fs.existsSync(dts)) {
    return { route, files, options: [], note: vscode.l10n.t("Configure this build to generate zephyr/zephyr.dts.") };
  }
  const cache = parseCMakeCache(binary);
  const args = [path.join(ctx.extension, "resources", "configuration_graph_dts.py"), dts, cache.ZEPHYR_BASE ?? ""];
  const python = graphPython(binary, ctx);
  const { stdout } = await promisify(execFile)(python, args, {
    env: toolEnvironment(),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { route, files, options: JSON.parse(stdout) };
}
