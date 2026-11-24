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

import "./cmake-section";
import { panelText } from "../../webview_shared/panel-text";
import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import type { ProjectBuildPanelData } from "../project-build-data";

import "./project-section";
import "./build-section";
import "./test-section";

@customElement("project-build-app")
export class ProjectBuildApp extends ZephyrLitElement {
  @state() private _data: ProjectBuildPanelData | undefined;
  /** Build/flash/debug action currently in flight, or null when idle. */
  @state() private _activeBuildAction: string | null = null;
  @state() private _statusAnnouncement = "";

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this._onMessage);
    // Tell the extension host we are ready to receive data.
    this.vscodeApi.postMessage({ command: "ready" });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this._onMessage);
  }

  private _onMessage = (event: MessageEvent) => {
    const msg = event.data;
    if (msg.command === "updateContent" && msg.data) {
      this._data = msg.data;
      this._statusAnnouncement = panelText("Project details updated");
    } else if (msg.command === "buildActionStatus") {
      if (msg.state === "started") {
        this._activeBuildAction = msg.action ?? null;
      } else if (msg.state === "finished") {
        // Only clear if the finished action matches the active one — guards
        // against late finished events from a previous click.
        if (!msg.action || this._activeBuildAction === msg.action) {
          this._activeBuildAction = null;
        }
      }
    }
  };

  private _onProjectChange(e: Event) {
    const select = e.currentTarget as { value?: string } | null;
    if (typeof select?.value !== "string") {
      return;
    }
    this.postCommand("switchProject", { project: select.value });
  }

  private _onBuildTestChange(e: Event) {
    const select = e.currentTarget as { value?: string } | null;
    if (typeof select?.value !== "string") {
      return;
    }
    this.postCommand("switchBuildOrTest", { selection: select.value });
  }

  @state() private buildMethod = this.readState<"CMake" | "west">("buildMethod");

  private selectMethod(method: "CMake" | "west") {
    this.buildMethod = method;
    this.saveState("buildMethod", method);
  }

  private renderSelector(label: string, options: ProjectBuildPanelData["buildTestOptions"], onChange: (event: Event) => void) {
    if (!options.length) { return nothing; }
    return html`<div class="project-selector">
      <span>${label}</span>
      <vscode-single-select aria-label=${label} @change=${onChange}>
        ${options.map(option => html`<vscode-option value=${option.value} ?selected=${option.selected}>
          ${option.label}
        </vscode-option>`)}
      </vscode-single-select>
    </div>`;
  }

  render() {
    if (!this._data) {
      return html`<div class="container panel-container"><p>${panelText("Loading…")}</p></div>`;
    }

    const d = this._data;
    const direct = (this.buildMethod ?? (d.hasWestWorkspace ? "west" : "CMake")) === "CMake";
    const projects = d.projectOptions.map(({ name, selected }) => ({ value: name, label: name, selected }));

    return html`
      <div class="container panel-container">
        <div class="sr-only" role="status" aria-live="polite">${this._statusAnnouncement}</div>
        <div class="page-header">
          <div>
            <h1 class="page-title"><i class="codicon codicon-project"></i> ${panelText("Project Details")}</h1>
          </div>
          <div class="page-header-selectors">
            ${this.renderSelector(panelText("Project:"), projects, this._onProjectChange)}
            ${this.renderSelector(panelText("Build / Test:"), d.buildTestOptions, this._onBuildTestChange)}
          </div>
        </div>

        <div class="workbench-method" role="group" aria-label=${panelText("Build method")}>
          <div class="method-options">
            ${(["CMake", "west"] as const).map(method => html`<button aria-pressed=${direct === (method === "CMake")}
              @click=${() => this.selectMethod(method)}>${method}</button>`)}
          </div>
          <vscode-button secondary @click=${() => this.postCommand("openGuide")}>${panelText("Workbench guide")}</vscode-button>
        </div>
        ${direct ? keyed(JSON.stringify([d.cmake.source, d.cmake.binary]), html`<cmake-section .data=${d.cmake} .busy=${!!this._activeBuildAction}></cmake-section>`) : this.renderWest(d)}
      </div>`;
  }

  private renderWest(d: ProjectBuildPanelData) {
    if (!d.projectOptions.length) {
      return html`<div class="no-project-notice">
        <i class="codicon codicon-info"></i>
        <p>${panelText("Choose an application folder or start from a Zephyr sample.")}</p>
        <vscode-button @click=${() => this.postCommand("addProject")}>${panelText("Add Project")}</vscode-button>
      </div>`;
    }

    return html`
      ${d.projectInfo ? html`<project-section .projectInfo=${d.projectInfo} .projectVars=${d.projectVars}
        .variableCommands=${d.variableCommands}></project-section>` : nothing}
      ${d.selectedProject ? this.renderProjectActions(d.selectedProject) : nothing}
      ${d.buildDetails ? html`<build-section .buildDetails=${d.buildDetails} .buildVars=${d.buildVars}
        .isActive=${d.isBuildActive} .projectName=${d.selectedProject} .variableCommands=${d.variableCommands}
        .activeAction=${this._activeBuildAction}></build-section>` : nothing}
      ${d.testDetails ? html`<test-section .testDetails=${d.testDetails}></test-section>` : nothing}
      ${!d.buildDetails && !d.testDetails && d.selectedProject
        ? this.renderBuildHint(d.buildTestOptions.length > 0) : nothing}`;
  }

  private renderProjectActions(project: string) {
    return html`<div class="project-actions-row">
      <vscode-button appearance="secondary" icon="add" @click=${() => this.postCommand("addBuild", { project })}>
        ${panelText("Add Build")}
      </vscode-button>
      <vscode-button appearance="secondary" icon="beaker" @click=${() => this.postCommand("addTest", { project })}>
        ${panelText("Add Test")}
      </vscode-button>
    </div>`;
  }

  private renderBuildHint(hasOptions: boolean) {
    return html`<div class="build-placeholder"><div class="build-placeholder-content">
      <i class=${hasOptions ? "codicon codicon-arrow-left" : "codicon codicon-add"}></i>
      <p>${hasOptions ? panelText("Select a build or test to view details.") : panelText("No builds or tests configured yet.")}</p>
    </div></div>`;
  }
}
