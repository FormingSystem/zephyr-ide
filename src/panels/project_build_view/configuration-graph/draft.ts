// SPDX-License-Identifier: Apache-2.0
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { inside } from "./catalog";
import { visualPreset, confEntries, renderChanges, validateValue, type Change } from "./documents";
import type { DraftView, GraphOption, Route } from "./types";

function checkedPath(root: string, file: string) {
  const target = path.resolve(root, file);
  const parent = fs.realpathSync(path.dirname(target));
  const realRoot = fs.realpathSync(root);
  if (
    !inside(realRoot, path.join(parent, path.basename(target))) ||
    fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()
  ) {
    throw Error(vscode.l10n.t("Choose a file inside the application."));
  }
  return target;
}

function snapshot(target: string) {
  if (!fs.existsSync(target)) {
    return;
  }
  const bytes = fs.readFileSync(target);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

export class FileDraft {
  revision = randomUUID();
  readonly changes = new Map<string, Change>();
  private readonly original?: string;
  constructor(
    private readonly root: string,
    readonly file: string,
    readonly route: Route,
  ) {
    this.original = snapshot(checkedPath(root, file));
  }
  get presetBoard(): string | undefined {
    if (this.route !== "board" || !this.original) {
      return;
    }
    const presets = JSON.parse(this.original.replace(/^\uFEFF/, "")).configurePresets ?? [];
    const board = presets.find((p: { name: string }) => p.name === visualPreset)?.cacheVariables?.BOARD;
    return typeof board === "string" ? board : board?.value;
  }
  get entries() {
    return this.route === "kconfig" ? Object.fromEntries(confEntries(this.original ?? "")) : {};
  }
  get view(): DraftView {
    const before = this.original ?? "";
    return {
      file: this.file,
      revision: this.revision,
      before,
      after: renderChanges(before, this.route, [...this.changes.values()]),
      keys: [...this.changes.keys()],
    };
  }
  stage(option: GraphOption, value: string | null) {
    if (value === null ? this.route !== "kconfig" : typeof value !== "string" || !validateValue(option, value)) {
      throw Error(vscode.l10n.t("Choose a valid value for this setting."));
    }
    const changes = this.route === "board" ? new Map<string, Change>() : new Map(this.changes);
    changes.set(option.id, { option, value });
    renderChanges(this.original ?? "", this.route, [...changes.values()]);
    this.changes.clear();
    for (const [id, change] of changes) {
      this.changes.set(id, change);
    }
  }
  save() {
    const { before, after } = this.view;
    if (before === after) {
      return false;
    }
    const target = checkedPath(this.root, this.file);
    const dirty = vscode.workspace.textDocuments.some(
      (doc) => doc.isDirty && doc.uri.scheme === "file" && !path.relative(doc.uri.fsPath, target),
    );
    if (dirty || this.original !== snapshot(target)) {
      throw Error(vscode.l10n.t("File changed outside this draft. Discard the draft and reopen the file."));
    }
    const temp = path.join(path.dirname(target), ".zephyr-ide-" + randomUUID());
    try {
      fs.writeFileSync(temp, after, { flag: "wx", mode: fs.statSync(target, { throwIfNoEntry: false })?.mode });
      if (this.original === undefined) {
        fs.linkSync(temp, target);
      } else {
        fs.renameSync(temp, target);
      }
    } finally {
      fs.rmSync(temp, { force: true });
    }
    return true;
  }
}
