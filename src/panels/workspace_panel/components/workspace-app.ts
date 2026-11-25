/*
Copyright 2026 mylonics 
Author Rijesh Augustine

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import "./west-project-picker";
import type { WestPickerData } from "./west-project-picker";
import { panelText } from "../../webview_shared/panel-text";
import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ZephyrLitElement } from '../../webview_shared/lit-base';
import { live } from "lit/directives/live.js";
import { updateOptions, type WorkspaceInfoData } from "../workspace-panel-data";
import type {
  WorkspacePanelData,
  SetupProgressData,
  SetupProgressStep,
  WorkspacePanelCommand,
} from '../workspace-panel-data';

@customElement('workspace-app')
export class WorkspaceApp extends ZephyrLitElement {
  @state() private _data?: WorkspacePanelData;
  @state() private checkingRemotes = false;
  @state() private modulesTab = false;
  @state() private _catalog?: WestPickerData;
  @state() private _progressData?: SetupProgressData;
  @state() private _workspaceSetupActive = false;
  @state() private _statusAnnouncement = '';

  private _dismissTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('message', this._onMessage);
    this._send('ready');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this._onMessage);
    if (this._dismissTimer) { clearTimeout(this._dismissTimer); }
  }

  private _onMessage = (e: MessageEvent) => {
    const msg = e.data;
    switch (msg.command) {
      case 'updateContent':
        this._data = msg.data as WorkspacePanelData;
        this._statusAnnouncement = panelText("Workspace panel updated");
        if (!this._progressData ||
          this._progressData.type === 'complete' ||
          this._progressData.type === 'failed') {
          this._workspaceSetupActive = false;
        }
        break;
      case 'showWorkspaceInfo':
        this.modulesTab = false;
        this.markNavigation("zephyr-ide.open-workspace-panel");
        break;
      case 'showWestModules':
        this.modulesTab = true;
        this.markNavigation("zephyr-ide.select-west-modules");
        void this.updateComplete.then(() => this.querySelector<HTMLInputElement>('west-project-picker input[type="search"]')?.focus());
        break;
      case 'checkingWestRemotes':
        if (this._catalog?.scope === msg.scope) { this.checkingRemotes = msg.checking; }
        break;
      case 'westProjects':
        if (this._catalog?.scope !== msg.scope) { this.checkingRemotes = false; }
        this._catalog = msg;
        break;
      case 'workspaceSetupProgress':
        this._handleProgress(msg.data as SetupProgressData);
        break;
    }
  };

  private markNavigation(command: string) {
    const nav = document.querySelector(".workbench-tools");
    nav?.querySelector("[aria-current]")?.removeAttribute("aria-current");
    nav?.querySelector(`[href="command:${command}"]`)?.setAttribute("aria-current", "page");
  }

  // ── Progress ──────────────────────────────────────────────

  private _handleProgress(data: SetupProgressData) {
    if (data.type === 'start' || data.type === 'step-update') {
      this._workspaceSetupActive = true;
    } else if (data.type === 'complete' || data.type === 'failed') {
      this._workspaceSetupActive = false;
    } else if (!this._workspaceSetupActive) {
      return;
    }
    this._progressData = data;
    // Note: previously auto-dismissed after 2s on completion; that hid
    // important final state (especially failures the user may have missed).
    // The user must now explicitly dismiss via the close button.
    if (this._dismissTimer) { clearTimeout(this._dismissTimer); this._dismissTimer = null; }
  }

  private _dismissProgress() {
    this._progressData = undefined;
    if (this._dismissTimer) { clearTimeout(this._dismissTimer); this._dismissTimer = null; }
  }

  // ── Commands ──────────────────────────────────────────────

  private _send(cmd: WorkspacePanelCommand, extras?: Record<string, unknown>) {
    this.vscodeApi.postMessage({ command: cmd, ...(extras ?? {}) });
  }

  private _sendWorkspaceSetup(cmd: WorkspacePanelCommand) {
    // "Mark as complete" completes synchronously on the extension side and
    // doesn't emit setup-progress events; don't show the initializing overlay.
    if (cmd !== 'markWorkspaceComplete' && cmd !== 'markWorkspaceCompleteExternal') {
      this._workspaceSetupActive = true;
    }
    this._send(cmd);
  }

  private _activateWorkspace(path: string) {
    this._send('activateWorkspace', { path });
  }

  // ── Render ────────────────────────────────────────────────

  render() {
    if (!this._data) {
      return html`<div class="container"><vscode-progress-ring></vscode-progress-ring></div>`;
    }

    const d = this._data;
    const showInitializing = this._workspaceSetupActive;
    const mode = d.panelMode;
    const showChoice = !showInitializing && mode === 'choice';
    const showNewCurrent = !showInitializing && mode === 'new-current';
    const showNewExternal = !showInitializing && mode === 'new-external';
    const showWorkspaceView = mode === 'workspace-view';
    const showReadyContent = !showInitializing && showWorkspaceView && d.folderOpen && d.workspaceInitialized;
    const showNoFolder = !showInitializing && showWorkspaceView && !d.folderOpen;
    // When an active workspace exists but hasn't been initialized yet, show
    // the current-folder setup tiles so the user can complete the setup.
    const showWorkspaceViewSetup = !showInitializing && showWorkspaceView && d.folderOpen && !d.workspaceInitialized && !d.isNonActive;

    return html`
      <div class=${this.modulesTab && showReadyContent ? "container modules-layout" : "container"}>
        <div class="sr-only" role="status" aria-live="polite">${this._statusAnnouncement}</div>
        <div class="page-header workspace-heading">
          <div style="display:flex;align-items:center;gap:12px;">
            <h1 class="page-title">${this.modulesTab ? panelText("West Git modules") : panelText("Workspace Setup")}</h1>
            <span class="header-status-badge ${d.statusClass}">${d.statusIcon} ${d.statusLabel}</span>
          </div>
          ${d.targetDirectory ? html`
            <div class="header-directory">
              <span class="codicon codicon-folder-opened"></span>
              <code>${d.targetDirectory}</code>
            </div>` : nothing}
        </div>

        ${d.activationBanner ? this._renderActivationBanner(d.activationBanner) : nothing}

        ${showInitializing ? this._renderInitializing() : nothing}
        ${showNoFolder ? this._renderNoFolder() : nothing}
        ${showChoice ? this._renderChoiceScreen(d) : nothing}
        ${showNewCurrent || showNewExternal || showWorkspaceViewSetup ? this._renderSetupChoices(showNewExternal) : nothing}
        ${showReadyContent ? this._renderReadyContent(d) : nothing}

      </div>
    `;
  }

  // ── Activation banner ─────────────────────────────────────

  private _renderActivationBanner(b: { name: string; path: string }) {
    return html`
      <div class="activation-banner" role="alert">
        <div class="activation-banner-content">
          <span class="codicon codicon-info"></span>
          <span>
            ${panelText("Viewing")} <strong>${b.name}</strong> ${panelText("(inactive). Setup and management actions are hidden until this workspace is activated.")}
          </span>
        </div>
        <vscode-button @click=${() => this._activateWorkspace(b.path)}>${panelText("Activate")}</vscode-button>
      </div>`;
  }

  // ── Initializing state ────────────────────────────────────

  private _renderInitializing() {
    return html`
      <div class="ws-state ws-state-initializing">
        <div class="status-banner status-info">
          <vscode-progress-ring></vscode-progress-ring>
          <span class="status-text">${panelText("Initializing workspace…")}</span>
        </div>
        <p class="description">${panelText("Follow the prompts in the VS Code dialog to configure your workspace.")}</p>
        ${this._progressData ? this._renderProgress(this._progressData) : nothing}
      </div>`;
  }

  private _renderProgress(data: SetupProgressData) {
    let bannerClass: string, bannerIcon: string, bannerText: string;
    switch (data.type) {
      case 'complete':
        bannerClass = 'status-success'; bannerIcon = 'check'; bannerText = 'Setup Complete'; break;
      case 'failed':
        bannerClass = 'status-error'; bannerIcon = 'error'; bannerText = 'Setup Failed'; break;
      default:
        bannerClass = 'status-info'; bannerIcon = ''; bannerText = 'Setting Up Workspace...'; break;
    }
    const showSpinner = data.type === 'start' || data.type === 'step-update';
    const showDismiss = data.type === 'complete' || data.type === 'failed';
    return html`
      <div class="setup-progress-panel">
        <div class="setup-progress-header ${bannerClass}">
          ${showSpinner ? html`<vscode-progress-ring></vscode-progress-ring>` : nothing}
          ${bannerIcon ? html`<span class="status-icon"><span class="codicon codicon-${bannerIcon}"></span></span>` : nothing}
          <span class="setup-progress-title">${data.operationLabel} — ${bannerText}</span>
          ${showDismiss ? html`<button class="setup-progress-dismiss" @click=${() => this._dismissProgress()} title="${panelText("Dismiss")}"><span class="codicon codicon-close"></span></button>` : nothing}
        </div>
        <div class="setup-progress-body">
          <div class="setup-progress-steps">
            ${data.steps.map(step => this._renderProgressStep(step))}
          </div>
          ${data.message ? html`<p class="setup-progress-message">${data.message}</p>` : nothing}
        </div>
      </div>`;
  }

  private _renderProgressStep(step: SetupProgressStep) {
    const iconMap: Record<string, string> = {
      'completed': 'check',
      'in-progress': 'sync codicon-modifier-spin',
      'failed': 'error',
      'skipped': 'dash',
    };
    const iconClass = iconMap[step.status] || 'circle-outline';
    return html`
      <div class="setup-step-item ${step.status}">
        <span class="setup-step-icon ${step.status}"><span class="codicon codicon-${iconClass}"></span></span>
        <div class="setup-step-content">
          <span class="setup-step-label">${step.label}</span>
          ${step.detail ? html`<span class="setup-step-detail">${step.detail}</span>` : nothing}
        </div>
      </div>`;
  }

  // ── No-folder state ───────────────────────────────────────

  private _renderNoFolder() {
    return html`
      <div class="ws-state ws-state-setup-required">
        <div class="status-banner status-info">
          <span class="codicon codicon-folder"></span>
          <span class="status-text">${panelText("No Folder Opened")}</span>
        </div>
        <p class="description">${panelText("Open a folder in VS Code to set up your Zephyr workspace.")}</p>
        <div class="section-container centered">
          <div class="empty-state">
            <span class="codicon codicon-folder-opened" aria-hidden="true"></span>
            <h3>${panelText("No Folder Open")}</h3>
            <p>${panelText("A workspace folder is required for Zephyr development.")}</p>
          </div>
          <div class="button-group">
            <vscode-button @click=${() => this._send('openFolder')}>
              <vscode-icon slot="start-icon" name="folder-opened"></vscode-icon>
              ${panelText("Open Folder")}
            </vscode-button>
          </div>
        </div>
      </div>`;
  }

  // ── Ready content (initialized workspace) ─────────────────

  private _renderReadyContent(d: WorkspacePanelData) {
    const info = d.workspaceInfo;
    if (!info) { return nothing; }
    const picker = html`<west-project-picker .checking=${this.checkingRemotes} .catalog=${this._catalog} .inactive=${d.isNonActive}></west-project-picker>`;
    if (this.modulesTab) {
      return html`<div class="ws-state ws-state-ready"><div class="section-container modules-content">${picker}</div></div>`;
    }
    return html`<section class="workspace-config">
      ${d.readiness !== "ready" ? this._renderPending(d) : nothing}
      <dl class="workspace-paths">
        ${this._pathRow(panelText("Current Folder:"), info.currentFolderPath)}
        ${this._pathRow(panelText("West.yml Location:"), info.westYmlPath)}
        ${this._pathRow(panelText("Python .venv Location:"), info.venvPath)}
        ${this._pathRow(panelText("Zephyr Version:"), info.zephyrVersion)}
      </dl>
      ${d.isNonActive ? nothing : html`
        ${this._renderUpdateOptions(info)}
        <details class="workspace-group"><summary>${panelText("West Git modules")}</summary>${picker}</details>
        ${this._renderWorkspaceManagement()}`}
    </section>`;
  }

  private _pathRow(label: string, value: string) {
    return html`<dt>${label}</dt><dd><code>${value}</code></dd>`;
  }

  private _renderPending(d: WorkspacePanelData) {
    const missing = [d.pythonEnvReady ? "" : panelText("python environment"), d.westUpdated ? "" : "west update"].filter(Boolean);
    return html`<div class="workspace-pending" role="status">${panelText("Workspace initialized — pending:")} ${missing.join(", ")}
      ${d.isNonActive ? nothing : html`<vscode-button @click=${() => this._send("rerunWestSetup")}>${panelText("Finish West Setup")}</vscode-button>`}
    </div>`;
  }

  private _renderUpdateOptions(info: WorkspaceInfoData) {
    const catalog = this._catalog?.scope === info.scope ? this._catalog : undefined;
    return html`<fieldset class="west-update-options"><legend>west update</legend>
      <label>update.fetch <select aria-label="update.fetch" .value=${live(catalog?.fetchMode ?? "")} ?disabled=${!catalog || !!catalog.error}
        @change=${(e: Event) => this._send("setFetchMode", { scope: info.scope, value: (e.target as HTMLSelectElement).value })}>
        <option value="">${panelText("Inherit west configuration")}</option>
        <option value="smart">smart</option><option value="always">always</option>
      </select></label>
      ${(Object.keys(updateOptions) as (keyof typeof updateOptions)[]).map(key => html`
        <label><input type="checkbox" .checked=${live(info.options[key])}
          @change=${(e: Event) => this._send("setUpdateOption", { key, value: (e.target as HTMLInputElement).checked, scope: info.scope })}>
          ${panelText(updateOptions[key])}</label>`)}
    </fieldset>`;
  }

  private _renderWorkspaceManagement() {
    const actions = [
      ["rerunWestSetup", "Re-run West Setup"], ["resetWorkspace", "Reset Workspace"],
      ["deactivateWorkspace", "Deactivate"], ["unregisterWorkspace", "Unregister"],
    ] as const;
    return html`<details class="workspace-group"><summary>${panelText("Workspace Management")}</summary>
      <div class="workspace-maintenance">${actions.map(([command, label]) => html`
        <vscode-button secondary @click=${() => this._send(command)}>${panelText(label)}</vscode-button>`)}</div>
    </details>`;
  }

  private workspaceAction(icon: string, title: string, description: string, action: () => void, disabled = false) {
    return html`<button type="button" class="workspace-option-card" ?disabled=${disabled} @click=${action}>
      <span class="codicon codicon-${icon}" aria-hidden="true"></span>
      <span><strong>${panelText(title)}</strong><small>${panelText(description)}</small></span>
    </button>`;
  }

  private _renderChoiceScreen(d: WorkspacePanelData) {
    const adopt = d.preexistingWorkspaceDetected;
    return html`<div class="workspace-options-grid">
      ${this.workspaceAction("folder-opened", adopt ? "Activate Preexisting Workspace in Current Folder" : "Create New Workspace in Current Folder",
        d.folderOpen ? (adopt ? "A .west/ directory was detected. Register it with Zephyr IDE and activate it." :
          "Configure the currently open folder as a new Zephyr workspace.") : "Open a folder first.",
        () => this._send(adopt ? "activatePreexisting" : "chooseNewInCurrent"), !d.folderOpen)}
      ${this.workspaceAction("new-folder", "Create New Workspace in External Directory",
        "Pick any directory outside the current folder and configure it as a Zephyr workspace.", () => this._send("chooseNewInExternal"))}
    </div>`;
  }

  private _renderSetupChoices(external: boolean) {
    const action = (icon: string, title: string, description: string, command: WorkspacePanelCommand) =>
      this.workspaceAction(icon, title, description, () => this._sendWorkspaceSetup(command));
    return html`<div class="workspace-options-grid">
      ${external ? nothing : action("git-clone", "Workspace from Zephyr IDE",
        "Clone a complete Zephyr IDE workspace or repo with projects as subdirectories using Git.", "workspaceSetupFromGit")}
      ${action("repo", "Workspace from Git", "Clone a west manifest repo (contains west.yml) using West Init.",
        external ? "workspaceSetupFromWestGitExternal" : "workspaceSetupFromWestGit")}
      ${action("package", "New Workspace", "Create a self-contained workspace with Zephyr installed locally.",
        external ? "workspaceSetupStandardExternal" : "workspaceSetupStandard")}
      ${action("folder-opened", "From Workspace Directory", external ? "Set up the external directory for Zephyr development, preserving existing files." :
        "Set up the current directory for Zephyr development, preserving existing files.", external ? "workspaceSetupFromDirectoryExternal" : "workspaceSetupFromCurrentDirectory")}
      ${action("check", "Mark as Complete", external ? "Register the external directory as an already-set-up workspace without running setup." :
        "Register the current directory as an already-set-up workspace without running setup.", external ? "markWorkspaceCompleteExternal" : "markWorkspaceComplete")}
    </div>`;
  }
}
