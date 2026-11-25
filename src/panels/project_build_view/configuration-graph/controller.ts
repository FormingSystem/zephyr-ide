// SPDX-License-Identifier: Apache-2.0
import { executeTaskHelper } from "../../../utilities/utils";
import { visualPreset } from "./documents";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { readCatalog, type GraphContext } from "./catalog";
import { FileDraft } from "./draft";
import { routes, type Catalog, type Route } from "./types";

export interface GraphMessage {
  action: string;
  route: Route;
  file: string;
  id: string;
  value: string | null;
  source: string;
  binary: string;
  request: string;
  revision?: string;
}

class ProjectGraph {
  readonly catalogs = new Map<Route, Catalog>();
  readonly drafts = new Map<string, FileDraft>();
  busy = false;
  private definitions?: string;
  async run(ctx: GraphContext, msg: GraphMessage) {
    if (ctx.definitions !== this.definitions) {
      this.catalogs.clear();
      this.definitions = ctx.definitions;
    }
    let catalog = this.catalogs.get(msg.route);
    if (!catalog || msg.action === "reload") {
      catalog = await readCatalog(ctx, msg.route);
      this.catalogs.set(msg.route, catalog);
    }
    const file = msg.file || catalog.files[0];
    if (!catalog.files.includes(file)) {
      throw Error(vscode.l10n.t("Choose a file inside the application."));
    }
    let draft = this.drafts.get(file) ?? new FileDraft(ctx.source, file, msg.route);
    this.drafts.set(file, draft);
    const modifies = ["stage", "undo", "save", "discard"].includes(msg.action);
    if (modifies && msg.revision !== draft.revision) {
      throw Error(vscode.l10n.t("The draft changed in another view. Refresh and review it again."));
    }
    let saved = false;
    if (msg.action === "stage") {
      const option = catalog.options.find((candidate) => candidate.id === msg.id);
      if (!option) {
        throw Error(vscode.l10n.t("Choose a configuration node."));
      }
      draft.stage(option, msg.value);
    }
    if (msg.action === "undo") {
      draft.changes.delete(msg.id);
    }
    if (msg.action === "save") {
      saved = draft.save();
    }
    if (modifies) {
      draft.revision = randomUUID();
    }
    if (saved || msg.action === "discard") {
      draft = new FileDraft(ctx.source, file, msg.route);
      this.drafts.set(file, draft);
    }
    let configured = false;
    if (msg.action === "configurePreset" && draft.presetBoard && !draft.changes.size) {
      configured = !!(await executeTaskHelper("CMake", ["cmake", "--preset", visualPreset], ctx.source));
      if (!configured) {
        throw Error(vscode.l10n.t("Configuration failed. See the task terminal."));
      }
    }
    const values = Object.fromEntries([...draft.changes].map(([id, c]) => [id, c.value]));
    return {
      catalog: msg.action === "open" || msg.action === "reload" ? catalog : undefined,
      draft: draft.view,
      entries: draft.entries,
      presetBoard: draft.presetBoard,
      configured,
      values,
      saved,
      pending: [...this.drafts.values()].filter((d) => d.changes.size).map((d) => d.file),
    };
  }
}

export class ConfigurationGraph {
  private readonly projects = new Map<string, ProjectGraph>();
  private readonly changed = new vscode.EventEmitter<{ key: string; payload: Record<string, unknown> }>();
  subscribe(ctx: { source: string; binary: string }, notify: (payload: Record<string, unknown>) => unknown) {
    const key = JSON.stringify([ctx.source, ctx.binary]);
    return this.changed.event((change) => {
      if (change.key === key) {
        notify(change.payload);
      }
    });
  }
  onChange(notify: (payload: Record<string, unknown>) => unknown) {
    return this.changed.event((change) => notify(change.payload));
  }
  async respond(ctx: GraphContext, msg: GraphMessage) {
    const response = { command: "configurationGraphResult", request: msg.request };
    try {
      return { ...response, ...(await this.handle(ctx, msg)) };
    } catch (error) {
      return { ...response, error: String(error) };
    }
  }
  async handle(ctx: GraphContext, msg: GraphMessage) {
    if (
      !vscode.workspace.isTrusted ||
      !ctx.source ||
      !ctx.binary ||
      msg.source !== ctx.source ||
      msg.binary !== ctx.binary ||
      !routes.includes(msg.route)
    ) {
      throw Error(vscode.l10n.t("Open a trusted application and build directory."));
    }
    const key = JSON.stringify([ctx.source, ctx.binary]);
    const project = this.projects.get(key) ?? new ProjectGraph();
    this.projects.set(key, project);
    if (project.busy) {
      throw Error(vscode.l10n.t("Another graph action is running."));
    }
    project.busy = true;
    try {
      const result = await project.run(ctx, msg);
      if (["stage", "undo", "save", "discard"].includes(msg.action)) {
        this.changed.fire({
          key,
          payload: {
            ...result,
            command: "graphDraftChanged",
            request: msg.request,
            source: ctx.source,
            binary: ctx.binary,
            route: msg.route,
          },
        });
      }
      return result;
    } finally {
      project.busy = false;
    }
  }
}

export const configurationGraph = new ConfigurationGraph();
