import * as vscode from "vscode";
import { configurationCommands } from "./configuration-navigation";

/** A configuration page shares one editor with the other pages in this window. */
export class ConfigurationPage {
  private static panel?: vscode.WebviewPanel;
  private static active?: ConfigurationPage;
  private static generation = 0;
  private readonly messages = new vscode.EventEmitter<any>();
  readonly onDidReceiveMessage = this.messages.event;
  readonly onDidDispose: vscode.Event<void>;
  private content = "";
  private ready = false;

  static open(extensionPath: string): ConfigurationPage {
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel("zephyrIDEConfiguration", "Zephyr IDE", vscode.ViewColumn.Active, {
        enableScripts: true,
        enableCommandUris: configurationCommands,
        localResourceRoots: [vscode.Uri.file(extensionPath)],
        retainContextWhenHidden: true,
      });
      this.panel = panel;
      panel.webview.onDidReceiveMessage(message => {
        const page = this.active;
        if (page && message?.configurationGeneration === this.generation) {
          page.ready = true;
          page.messages.fire(message);
        }
      });
      panel.onDidDispose(() => {
        this.active = undefined;
        this.panel = undefined;
      });
    }
    const page = new ConfigurationPage(this.panel);
    page.show();
    return page;
  }

  private constructor(private readonly editor: vscode.WebviewPanel) {
    this.onDidDispose = editor.onDidDispose;
  }

  get cspSource() { return this.editor.webview.cspSource; }

  asWebviewUri(uri: vscode.Uri) { return this.editor.webview.asWebviewUri(uri); }

  set html(value: string) {
    this.content = value;
    if (ConfigurationPage.active === this) { this.render(); }
  }

  show(): boolean {
    this.editor.reveal();
    if (ConfigurationPage.active === this) { return false; }
    ConfigurationPage.active = this;
    this.ready = false;
    if (this.content) { this.render(); }
    return true;
  }

  private render() {
    const generation = ++ConfigurationPage.generation;
    this.editor.webview.html = this.content.replace("<head>", `<head><meta name="zephyr-configuration-generation" content="${generation}">`);
  }

  postMessage(message: unknown): Thenable<boolean> {
    if (!this.ready || ConfigurationPage.active !== this) { return Promise.resolve(false); }
    return this.editor.webview.postMessage(message);
  }

  dispose() {
    this.messages.dispose();
  }
}
