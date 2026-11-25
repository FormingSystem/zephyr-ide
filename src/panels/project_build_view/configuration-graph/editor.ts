// SPDX-License-Identifier: Apache-2.0
import * as vscode from "vscode";
import * as path from "path";
import { generateNonce } from "../../webview_shared/nonce";
import { webviewMessages } from "../../webview-messages";
import type { GraphContext } from "./catalog";
import { configurationGraph, type GraphMessage } from "./controller";
import type { Route } from "./types";

export interface GraphPosition {
  route: Route;
  file?: string;
  query?: string;
  selected?: string;
}
const contexts = new WeakMap<vscode.WebviewPanel, GraphContext>();
const editors = new Map<string, vscode.WebviewPanel>();

function html(view: vscode.Webview, ctx: GraphContext, position: GraphPosition) {
  const asset = (name: string) => view.asWebviewUri(vscode.Uri.joinPath(vscode.Uri.file(ctx.extension), name));
  const nonce = generateNonce();
  const initial = JSON.stringify({ source: ctx.source, binary: ctx.binary, ...position }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.cspSource}; font-src ${view.cspSource}; script-src 'nonce-${nonce}'">
    <link rel="stylesheet" href="${asset("src/panels/project_build_view/project-build-panel.css")}">
    <link rel="stylesheet" href="${asset("node_modules/@vscode/codicons/dist/codicon.css")}">
    </head><body class="cg-editor">${webviewMessages(nonce)}
    <script nonce="${nonce}" type="application/json" id="cg-position">${initial}</script>
    <configuration-map expanded></configuration-map>
    <script nonce="${nonce}" src="${asset("dist/webview/project_build_view/project-build-panel.js")}"></script></body></html>`;
}

async function detach(panel: vscode.WebviewPanel) {
  panel.reveal(undefined, false);
  const command = "workbench.action.moveEditorToNewWindow";
  if (!(await vscode.commands.getCommands(true)).includes(command)) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("This VS Code version supports the full editor view only."),
    );
    return;
  }
  // Target only our editor, even if focus changes while VS Code reveals it.
  const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (active instanceof vscode.TabInputWebview && active.viewType.endsWith(panel.viewType)) {
    await vscode.commands.executeCommand(command);
  }
}

export async function openGraphEditor(ctx: GraphContext, position: GraphPosition, newWindow: boolean) {
  const key = JSON.stringify([ctx.source, ctx.binary]);
  let panel = editors.get(key);
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "zephyrIdeConfigurationMap",
      vscode.l10n.t("Configuration map") + " · " + path.basename(ctx.source),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(ctx.extension)] },
    );
    const editor = panel;
    const sub = configurationGraph.subscribe(ctx, (change) => editor.webview.postMessage(change));
    editor.onDidDispose(() => {
      sub.dispose();
      editors.delete(key);
    });
    editor.webview.onDidReceiveMessage(async (msg: GraphMessage & { command: string }) => {
      if (msg.command === "graphNewWindow") {
        await detach(editor);
      }
      if (msg.command === "configurationGraph") {
        await editor.webview.postMessage(await configurationGraph.respond(contexts.get(editor) ?? ctx, msg));
      }
    });
    editors.set(key, editor);
    editor.webview.html = html(editor.webview, ctx, position);
  } else {
    panel.reveal(undefined, false);
    void panel.webview.postMessage({ command: "graphPosition", ...position });
  }
  contexts.set(panel, ctx);
  if (newWindow) {
    await detach(panel);
  }
}
