// SPDX-License-Identifier: Apache-2.0
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repositoryAddresses } from "../../../utilities/repository-addresses";
import { live } from "lit/directives/live.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import "./west-repository-search";
import type { WestRepositorySearch } from "./west-repository-search";
import { moduleMatcher, moduleSearchBox } from "../../webview_shared/module-search";
import type { GitHubRepository } from "../../../setup_utilities/github-repositories";
import { changeSelection, westSelectionPane, westSelectionToolbar, type SelectionAction } from "../../webview_shared/west-selection";
import { panelText as t } from "../../webview_shared/panel-text";
import type { WestCatalog, WestProject } from "../../../setup_utilities/west-projects";

export interface WestPickerData extends WestCatalog {
  scope: string;
  selected: string[];
  error?: string;
  editError?: string;
  added?: string[];
}

@customElement("west-project-picker")
export class WestProjectPicker extends ZephyrLitElement {
  @property({ attribute: false }) catalog?: WestPickerData;
  @property({ type: Boolean }) inactive = false;
  @state() private selected = new Set<string>();
  @state() private query = "";
  @state() private regex = false;
  @state() private discover = false;
  @state() private adding = false;
  @state() private lineCount = 0;
  @state() private editing?: WestProject;

  protected willUpdate(changes: PropertyValues) {
    if (changes.has("catalog") && this.catalog) {
      const known = new Set(this.catalog.projects.map(p => p.name));
      this.selected = new Set(this.catalog.selected.filter(n => known.has(n)));
      if ((changes.get("catalog") as WestPickerData | undefined)?.scope !== this.catalog.scope) { this.query = ""; this.regex = false; this.discover = false; this.adding = false; }
      if (this.catalog.added) { this.adding = false; }
    }
  }

  private send(command: string, extras: Record<string, unknown> = {}) {
    this.vscodeApi.postMessage({ command, scope: this.catalog?.scope, ...extras });
  }

  private setSelection(rows: WestProject[], action: SelectionAction) {
    const names = changeSelection(this.selected, rows.map(p => p.name), action);
    this.selected = names;
    this.send("selectWestProjects", { names: [...names] });
  }

  private add(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    this.send("editWestProject", { url: fields.get("url"), revision: fields.get("revision"), destination: fields.get("destination"), previous: this.editing?.name });
  }

  private async showForm(repo?: GitHubRepository, existing?: WestProject) {
    this.adding = true;
    this.editing = existing;
    this.lineCount = repo || existing ? 1 : 0;
    await this.updateComplete;
    const form = this.querySelector("form");
    if (!form) { return; }
    const url = form.elements.namedItem("url") as HTMLTextAreaElement;
    url.value = existing?.url ?? (repo ? "https://github.com/" + repo.full_name : "");
    (form.elements.namedItem("revision") as HTMLInputElement).value = existing?.revision ?? repo?.default_branch ?? "";
    (form.elements.namedItem("destination") as HTMLInputElement).value = existing?.path ?? "";
    url.focus();
  }

  private origin(p: WestProject) {
    if (!p.extra) { return t("Workspace manifest"); }
    return /(?:^https?:\/\/|^ssh:\/\/git@|^git@)github\.com[/:]zephyrproject-rtos\//i.test(p.url)
      ? t("Official GitHub repositories") : t("Custom Git repositories");
  }

  private group(rows: WestProject[], label: string, pinned = false) {
    return html`<section class="wp-group" aria-label=${label}>
      ${pinned ? nothing : html`<h5>${label} <small>${rows.length}</small></h5>`}
      ${rows.length === 0 ? html`<p class="wp-empty">${pinned ? t("No modules selected") : t("No matches")}</p>` : nothing}
      ${rows.map(p => html`<div class="wp-row west-choice">
        <label title=${[p.url, p.revision].join("\n")}>
          <input type="checkbox" .checked=${live(this.selected.has(p.name))} ?disabled=${this.inactive}
            @change=${() => this.setSelection([p], "invert")}>
          <span><strong>${p.name}</strong><small>${p.path}${pinned ? " · " + this.origin(p) : ""}</small></span>
        </label>
        <code title=${p.revision}>${/^[0-9a-f]{40,64}$/i.test(p.revision) ? p.revision.slice(0, 10) : p.revision}</code>
        ${!this.inactive ? html`<button type="button" aria-label=${t("Edit {0}", p.name)} @click=${() => this.showForm(undefined, p)}>${t("Edit")}</button><button type="button" aria-label=${t("Remove {0}", p.name)}
          @click=${() => this.send("editWestProject", { remove: p.name })}>${t("Remove")}</button>` : nothing}
      </div>`)}
    </section>`;
  }

  render() {
    const data = this.catalog;
    const { matches, invalid } = moduleMatcher(this.query, this.regex);
    const projects = data?.projects ?? [];
    const detail = this.query.trim().toLowerCase();
    const searchPath = !this.regex && detail.includes("/");
    const searchRevision = !this.regex && /^[a-f0-9]{7,}$/i.test(detail);
    const rows = projects.filter(p => matches(p.name) ||
      (searchPath && [p.path, p.url].some(value => value.toLowerCase().includes(detail))) ||
      (searchRevision && p.revision.toLowerCase().startsWith(detail)));
    const selected = projects.filter(p => this.selected.has(p.name));
    const available = rows.filter(p => !this.selected.has(p.name));
    const sources = [t("Workspace manifest"), t("Official GitHub repositories"), t("Custom Git repositories")];
    const locked = this.inactive || !rows.length;
    return html`
      <div class="wp-tools">
        ${moduleSearchBox(this.query, this.regex, value => { this.query = value; }, () => { this.regex = !this.regex; })}
        ${this.inactive ? nothing : html`
          <button type="button" ?disabled=${!data || !this.query.trim() || invalid}
            @click=${() => { this.discover = true; this.querySelector<WestRepositorySearch>("west-repository-search")?.runSearch(); }}>${t("Search GitHub sources")}</button>
          <button type="button" @click=${() => this.showForm()}>${t("Add Git repositories")}</button>`}
        <button type="button" @click=${() => this.send("refreshWestProjects")}>${t("Refresh")}</button>
        <button type="button" @click=${() => this.send("openWestYml")}>${t("Open in Editor")}</button>
      </div>
      ${this.adding && !this.inactive ? html`<form @submit=${this.add}>
              <label>${this.editing ? t("Repository or commit URL") : t("Repository addresses")}
                <textarea required name="url" rows="3" spellcheck="false" aria-describedby="wp-url-help"
                  placeholder="https://github.com/owner/hal_example"
                  @input=${(e: Event) => { this.lineCount = repositoryAddresses((e.target as HTMLTextAreaElement).value).length; }}></textarea>
                <small id="wp-url-help">${this.editing ? t("Edit the address for this repository.") :
                  t("One repository per line. Press Enter for a new line. Blank lines and surrounding spaces are ignored.")}</small>
              </label>
              ${this.lineCount > 1 && !this.editing ? html`<p>${t("Each repository gets its own checkout path. Commit URLs pin the revision; other addresses use HEAD.")}</p>` : html`
                <label>${t("Branch, tag or commit")}<input name="revision" placeholder="HEAD"></label>
                <label>${t("Checkout path")}<input name="destination" placeholder="modules/lib/…"></label>`}
              <button type="submit" ?disabled=${!this.lineCount || (!!this.editing && this.lineCount !== 1)}>
                ${this.editing ? t("Save") : t("Add repositories ({0})", this.lineCount)}</button>
              <button type="button" @click=${() => { this.adding = false; }}>${t("Cancel")}</button>
            </form>` : nothing}
      ${data?.editError ? html`<p role="alert">${data.editError}</p>` : nothing}
      ${invalid ? html`<p role="alert">${t("Invalid regular expression")}</p>` : nothing}
      ${!data ? html`<p role="status">${t("Loading west projects…")}</p>` : data.error ? html`<p role="alert">${data.error}</p>` : html`
        ${data.partial ? html`<p role="status">${t("Update the manifest provider and refresh to see its modules.")}</p>` : nothing}
        <div class="wp-tools">
          ${westSelectionToolbar(locked, action => this.setSelection(rows, action))}
          <span role="status">${t("{0} matched", rows.length)}</span>
        </div>
        ${this.discover && !this.inactive ? html`<west-repository-search .scope=${data.scope} .query=${this.query}
          .regex=${this.regex} .known=${projects.map(p => p.name.toLowerCase())}
          .choose=${(repo: GitHubRepository) => this.showForm(repo)}></west-repository-search>` : nothing}
        <div class="west-panes">
          ${westSelectionPane("wp-selected-title", t("Selected modules"), selected.length,
            this.group(selected, t("Selected modules"), true))}
          ${westSelectionPane("wp-available-title", t("Available modules"), available.length, html`
            ${sources.map(label => {
              const group = available.filter(p => this.origin(p) === label);
              return group.length ? this.group(group, label) : nothing;
            })}
            ${available.length ? nothing : html`<p class="wp-empty">${t("No available modules")}</p>`}`)}
        </div>
        ${this.inactive ? nothing : html`
          <div class="wp-tools wp-actions">
            <vscode-button ?disabled=${!this.selected.size} @click=${() => this.send("updateWestProjects", { names: [...this.selected] })}>
              ${t("Update selected ({0})", this.selected.size)}</vscode-button>
            <button type="button" @click=${() => this.send("updateWestProjects", { names: [], all: true })}>${t("Run a full west update")}</button>
          </div>`}
      `}`;
  }
}
