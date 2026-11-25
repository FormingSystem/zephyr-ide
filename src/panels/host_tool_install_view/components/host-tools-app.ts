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

import { panelText } from "../../webview_shared/panel-text";
import { html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { ZephyrLitElement } from '../../webview_shared/lit-base';
import { HostToolsClient } from '../../webview_shared/hostToolsClient';

@customElement('host-tools-app')
export class HostToolsApp extends ZephyrLitElement {
  private _client!: HostToolsClient;

  /**
   * Windows long paths status.
   * undefined  = not Windows (banner hidden)
   * false      = Windows, long paths NOT enabled (banner shown)
   * true       = Windows, long paths ARE enabled (banner hidden)
   */
  @state() private _windowsLongPathsEnabled: boolean | undefined = undefined;

  /**
   * Optional 7-Zip status on Windows.
   * undefined  = not Windows (section hidden)
   * false      = Windows, 7-Zip NOT installed
   * true       = Windows, 7-Zip IS installed
   */
  @state() private _sevenZipAvailable: boolean | undefined = undefined;
  @state() private _sevenZipInstalling = false;

  connectedCallback() {
    super.connectedCallback();
    this._client = new HostToolsClient(this.vscodeApi);
    window.addEventListener('message', this._onMessage);
    // No 'ready' post here — firstUpdated() calls refreshStatus() once the
    // DOM IDs exist, avoiding a duplicate parallel status check on startup.
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this._onMessage);
  }

  private _onMessage = (e: MessageEvent) => {
    const msg = e.data as Record<string, any>;
    // Extract Windows long paths status from updateStatus payloads before
    // delegating to the shared client, which handles package card rendering.
    if (msg.command === 'hostToolsUpdateStatus' && msg.data) {
      const enabled = msg.data.windowsLongPathsEnabled;
      if (typeof enabled === 'boolean') {
        this._windowsLongPathsEnabled = enabled;
      }
      const sevenZip = msg.data.sevenZipAvailable;
      if (typeof sevenZip === 'boolean') {
        this._sevenZipAvailable = sevenZip;
      } else if (sevenZip === null) {
        // null = explicitly not-Windows, keep undefined to hide the section
      }
    }
    if (msg.command === 'sevenZipInstalling') {
      this._sevenZipInstalling = true;
    }
    if (msg.command === 'sevenZipInstalled') {
      this._sevenZipInstalling = false;
      if (typeof msg.available === 'boolean') {
        this._sevenZipAvailable = msg.available;
      }
    }
    this._client.handleMessage(msg);
  };

  firstUpdated() {
    // Trigger initial status check now that the DOM IDs are available
    this._client.refreshStatus();
  }

  private renderOptionalTool() {
    if (this._sevenZipAvailable === undefined) { return nothing; }
    return html`<div class="optional-tool">
      <span>${panelText("Optional: 7-Zip")}</span>
      ${this._sevenZipAvailable
        ? html`<span class="status-available">${panelText("✓ Installed")}</span>`
        : html`<vscode-button secondary ?disabled=${this._sevenZipInstalling}
            @click=${() => this.postCommand('install7zip')}>
            ${this._sevenZipInstalling ? panelText("Installing") : panelText("Install")}
          </vscode-button>`}
    </div>`;
  }

  private renderLongPathsWarning() {
    if (this._windowsLongPathsEnabled !== false) { return nothing; }
    return html`<div class="host-warning">
      <span>${panelText("Long paths are disabled. Building Python packages may fail.")}</span>
      <vscode-button secondary @click=${() => this.postCommand('enableWindowsLongPaths')}>
        ${panelText("Enable long paths (administrator)")}
      </vscode-button>
    </div>`;
  }

  render() {
    return html`<main class="container host-tools">
      <header class="page-header">
        <h1 class="page-title">${panelText("Host Tools")}</h1>
        <vscode-button secondary @click=${() => this.postCommand("toolEnvironment")}>
          ${panelText("Local tool environment")}
        </vscode-button>
      </header>
      ${this.renderLongPathsWarning()}
      <div id="manager-status">${panelText("Checking package manager...")}</div>
      <section aria-labelledby="tools-heading">
        <div class="tool-list-header">
          <h2 id="tools-heading">${panelText("Required Development Tools")}</h2>
          <span id="tools-summary" role="status"></span>
        </div>
        <div id="packages-status">${panelText("Checking packages...")}</div>
      </section>
      <div class="host-actions">
        <vscode-button id="install-all-btn" data-action="installAllMissing" disabled>
          ${panelText("Install All Missing Packages")}
        </vscode-button>
        <vscode-button id="refresh-btn" secondary @click=${() => this._client.refreshStatus()}>
          ${panelText("Refresh Status")}
        </vscode-button>
        <vscode-button id="mark-complete-btn" secondary disabled @click=${() => this.postCommand('markComplete')}>
          ${panelText("Skip & Mark as Complete")}
        </vscode-button>
      </div>
      ${this.renderOptionalTool()}
      <details class="install-notes">
        <summary>${panelText("Installation notes")}</summary>
        <p>${panelText("VS Code may need to be restarted after installation for tools to be available in the PATH.")}</p>
        ${this._sevenZipAvailable === undefined ? nothing : html`<p>${panelText("The SDK panel can extract archives with tar.exe. Some west sdk workflows also use 7-Zip.")}</p>`}
      </details>
    </main>`;
  }
}
