// SPDX-License-Identifier: Apache-2.0
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isPinnedRevision } from "../../../utilities/west-revision";
import { repositoryAddresses } from "../../../utilities/repository-addresses";
import { live } from "lit/directives/live.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import "./west-repository-search";
import type { WestRepositorySearch } from "./west-repository-search";
import { moduleMatcher, moduleSearchBox } from "../../webview_shared/module-search";
import type { GitHubRepository } from "../../../setup_utilities/github-repositories";
import { changeSelection, westSelectionPane, westSelectionToolbar, type SelectionAction } from "../../webview_shared/west-selection";
import { panelText } from "../../webview_shared/panel-text";
import type { DependencyReference, DetectedDependency, WestCatalog, WestProject } from "../../../setup_utilities/west-projects";

export interface WestPickerData extends WestCatalog {
  scope: string;
  selected: string[];
  detected?: DetectedDependency[];
  unresolved?: DependencyReference[];
  error?: string;
  editError?: string;
  added?: string[];
}

const modulesPerPage = 20;

interface PickerPosition {
  page?: number;
  scope: string;
  query: string;
  regex: boolean;
  scroll: number[];
}

@customElement("west-project-picker")
export class WestProjectPicker extends ZephyrLitElement {
  @property({ attribute: false }) catalog?: WestPickerData;
  @property({ type: Boolean }) checking = false;
  @property({ type: Boolean }) inactive = false;
  @state() private selected = new Set<string>();
  @state() private query = "";
  @state() private regex = false;
  @state() private page = 0;
  @state() private discover = false;
  @state() private adding = false;
  @state() private lineCount = 0;
  @state() private editing?: WestProject;

  private get position() {
    return this.readState<PickerPosition>("picker");
  }

  private remember = () => {
    if (!this.catalog) { return; }
    const scroll = Array.from(this.querySelectorAll(".west-pane-list"), el => el.scrollTop);
    const picker = { scope: this.catalog.scope, query: this.query, regex: this.regex, page: this.page, scroll };
    this.saveState("picker", picker);
  };

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("scroll", this.remember, true);
  }

  disconnectedCallback() {
    this.removeEventListener("scroll", this.remember, true);
    super.disconnectedCallback();
  }

  protected updated(changes: PropertyValues) {
    const previous = changes.get("catalog") as WestPickerData | undefined;
    const saved = this.position;
    if (changes.has("catalog") && previous?.scope !== this.catalog?.scope && saved && saved.scope === this.catalog?.scope) {
      this.querySelectorAll(".west-pane-list").forEach((el, i) => { el.scrollTop = saved.scroll[i] ?? 0; });
    }
  }

  protected willUpdate(changes: PropertyValues) {
    const catalog = this.catalog;
    if (!changes.has("catalog") || !catalog) { return; }

    const knownNames = new Set(catalog.projects.map(project => project.name));
    this.selected = new Set(catalog.selected.filter(name => knownNames.has(name)));

    const previous = changes.get("catalog") as WestPickerData | undefined;
    if (previous?.scope !== catalog.scope) {
      const saved = this.position;
      this.page = saved?.scope === catalog.scope ? saved.page ?? 0 : 0;
      this.query = saved?.scope === catalog.scope ? saved.query : "";
      this.regex = saved?.scope === catalog.scope && saved.regex;
      this.discover = false;
      this.adding = false;
    } else if (catalog.added) {
      this.adding = false;
    }
  }

  private send(command: string, extras: Record<string, unknown> = {}) {
    this.vscodeApi.postMessage({ command, scope: this.catalog?.scope, ...extras });
  }

  private setSelection(rows: WestProject[], action: SelectionAction) {
    const names = changeSelection(this.selected, rows.map(project => project.name), action);
    this.selected = names;
    this.send("selectWestProjects", { names: [...names] });
  }

  private add(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
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

  private origin(project: WestProject) {
    if (!project.extra) { return panelText("Workspace manifest"); }
    return /(?:^https?:\/\/|^ssh:\/\/git@|^git@)github\.com[/:]zephyrproject-rtos\//i.test(project.url)
      ? panelText("Official GitHub repositories") : panelText("Custom Git repositories");
  }

  private checkoutStatus(project: WestProject) {
    const status = (tone: string, icon: string, text: string) => html`
      <span class="wp-status" data-tone=${tone}>
        <span class="codicon codicon-${icon}" aria-hidden="true"></span>${text}
      </span>`;
    const { checkout, revision, remote } = project;
    if (checkout.state === "absent") { return status("muted", "cloud-download", panelText("Not downloaded")); }
    if (checkout.state === "invalid") { return status("error", "error", panelText("Checkout unavailable")); }
    if (isPinnedRevision(revision)) {
      return checkout.head === revision.toLowerCase()
        ? status("success", "check", panelText("At manifest revision"))
        : status("warning", "warning", panelText("Differs from manifest"));
    }
    if (!remote) { return status("downloaded", "clock", panelText("Downloaded · remote unchecked")); }
    if (remote.error) {
      return status("error", "error", remote.error === "refMissing" ? panelText("Downloaded · remote ref missing") : panelText("Downloaded · check failed"));
    }
    return checkout.head === remote.sha
      ? status("success", "check", panelText("Matches remote"))
      : status("info", "git-compare", panelText("Differs from remote"));
  }

  private dependencyReason(name: string) {
    const dependency = this.catalog?.detected?.find(item => item.name === name);
    if (dependency) {
      return html`<small title=${dependency.sources.join("\n")}>${panelText("Required by {0}", dependency.requiredBy.join(", "))}</small>`;
    }
    return this.selected.has(name) ? html`<small>${panelText("Manually selected")}</small>` : nothing;
  }

  private rowIcon(icon: string, label: string, action: () => void) {
    return html`<button type="button" title=${label} aria-label=${label} @click=${action}>
      <span class="codicon codicon-${icon}" aria-hidden="true"></span></button>`;
  }

  private group(rows: WestProject[], label: string, pinned = false) {
    return html`<section class="wp-group" aria-label=${label}>
      ${pinned ? nothing : html`<h5>${label} <small>${rows.length}</small></h5>`}
      ${rows.length === 0 ? html`<p class="wp-empty">${pinned ? panelText("No modules selected") : panelText("No matches")}</p>` : nothing}
      ${rows.map(project => html`<div class="wp-row west-choice">
        <label title=${[project.url, project.revision].join("\n")}>
          <input type="checkbox" .checked=${live(this.selected.has(project.name))} ?disabled=${this.inactive}
            @change=${() => this.setSelection([project], "invert")}>
          <span class="wp-identity"><strong>${project.name}</strong><small>${project.path}${pinned ? " · " + this.origin(project) : ""}</small>${this.dependencyReason(project.name)}</span>
        </label>
        <span class="wp-checkout" title=${[project.checkout.head, project.remote?.sha].filter(Boolean).join(" → ")}>
          ${this.checkoutStatus(project)}${project.remote && project.checkout.state === "cloned" ? html`<small>${panelText("Checked {0}", new Date(project.remote.checkedAt).toLocaleString())}</small>` : nothing}
        </span>
        <span class="wp-revision" title=${panelText("Manifest revision") + " · " + project.revision}>
          <code aria-label=${panelText("Manifest revision") + " " + project.revision}>${/^[0-9a-f]{40,64}$/i.test(project.revision) ? project.revision.slice(0, 10) : project.revision}</code>
          ${project.revision === "HEAD" ? html`<small>${panelText("Not pinned to a commit")}</small>` : nothing}
        </span>
        ${!this.inactive ? html`
          <button type="button" aria-label=${project.checkout.state === "absent" ? panelText("Download {0}", project.name) : panelText("Update {0}", project.name)}
            @click=${() => this.send("updateWestProjects", { names: [project.name], preserveSelection: true })}>
            ${project.checkout.state === "absent" ? panelText("Download") : panelText("Update")}
          </button>
          ${this.rowIcon("edit", panelText("Edit {0}", project.name), () => this.showForm(undefined, project))}
          ${this.rowIcon("trash", panelText("Remove {0}", project.name), () => this.send("editWestProject", { remove: project.name }))}` : nothing}
      </div>`)}
    </section>`;
  }

  private searchGitHub() {
    this.discover = true;
    this.querySelector<WestRepositorySearch>("west-repository-search")?.runSearch();
  }

  private renderRepositoryForm() {
    if (!this.adding || this.inactive) { return nothing; }

    const multipleRepositories = !this.editing && this.lineCount > 1;
    const canSubmit = this.editing ? this.lineCount === 1 : this.lineCount > 0;
    return html`<form @submit=${this.add}>
      <label>${this.editing ? panelText("Repository or commit URL") : panelText("Repository addresses")}
        <textarea required name="url" rows="3" spellcheck="false" aria-describedby="wp-url-help"
          placeholder="https://github.com/owner/hal_example"
          @input=${(e: Event) => { this.lineCount = repositoryAddresses((e.target as HTMLTextAreaElement).value).length; }}></textarea>
        <small id="wp-url-help">${this.editing ? panelText("Edit the address for this repository.") :
          panelText("One repository per line. Press Enter for a new line. Blank lines and surrounding spaces are ignored.")}</small>
      </label>
      ${multipleRepositories ? html`<p>${panelText("Each repository gets its own checkout path. Commit URLs pin the revision; other addresses use HEAD.")}</p>` : html`
        <label>${panelText("Branch, tag or commit")}<input name="revision" placeholder="HEAD"></label>
        <label>${panelText("Checkout path")}<input name="destination" placeholder="modules/lib/…"></label>`}
      <button type="submit" ?disabled=${!canSubmit}>
        ${this.editing ? panelText("Save") : panelText("Add repositories ({0})", this.lineCount)}</button>
      <button type="button" @click=${() => { this.adding = false; }}>${panelText("Cancel")}</button>
    </form>`;
  }

  private matchingProjects(projects: WestProject[], matches: (name: string) => boolean) {
    const query = this.query.trim().toLowerCase();
    const searchPath = !this.regex && query.includes("/");
    const searchRevision = !this.regex && /^[a-f0-9]{7,}$/i.test(query);
    return projects.filter(project => matches(project.name) ||
      (searchPath && [project.path, project.url].some(value => value.toLowerCase().includes(query))) ||
      (searchRevision && project.revision.toLowerCase().startsWith(query)));
  }

  private changePage(page: number) {
    this.page = page;
    const list = this.querySelector<HTMLElement>('[aria-labelledby="wp-available-title"]');
    if (list) { list.scrollTop = 0; }
    this.remember();
  }

  private pageControls(page: number, pages: number) {
    if (pages < 2) { return; }
    return html`<div class="wp-pager">
      <button type="button" ?disabled=${page === 0} aria-label=${panelText("Previous page")}
        title=${panelText("Previous page")} @click=${() => this.changePage(page - 1)}><span class="codicon codicon-chevron-left" aria-hidden="true"></span></button>
      <span role="status">${panelText("Page {0} of {1}", page + 1, pages)}</span>
      <button type="button" ?disabled=${page === pages - 1} aria-label=${panelText("Next page")}
        title=${panelText("Next page")} @click=${() => this.changePage(page + 1)}><span class="codicon codicon-chevron-right" aria-hidden="true"></span></button>
    </div>`;
  }

  private shorterList(selected: number, available: number) {
    if (selected * 2 < available) { return "selected"; }
    if (available * 2 < selected) { return "available"; }
    return undefined;
  }

  private renderCatalog(data: WestPickerData | undefined, matches: (name: string) => boolean) {
    if (!data) {
      return html`<p role="status">${panelText("Loading west projects…")}</p>`;
    }
    if (data.error) {
      return html`<p role="alert">${data.error}</p>`;
    }
    const projects = data.projects;
    const rows = this.matchingProjects(projects, matches);
    const selected = projects.filter(project => this.selected.has(project.name));
    const available = rows.filter(project => !this.selected.has(project.name));
    const sources = [panelText("Workspace manifest"), panelText("Official GitHub repositories"), panelText("Custom Git repositories")];
    const pages = Math.max(1, Math.ceil(available.length / modulesPerPage));
    const page = Math.min(this.page, pages - 1);
    const ordered = sources.flatMap(source => available.filter(project => this.origin(project) === source));
    const visible = ordered.slice(page * modulesPerPage, (page + 1) * modulesPerPage);
    const locked = this.inactive || !rows.length;
    return html`
      ${data.unresolved?.map(ref => html`<p role="status" title=${ref.sources.join("\n")}><strong>${ref.name}</strong> · ${panelText("Required by {0}", ref.requiredBy.join(", "))} · ${panelText("No revision in the west manifest")}</p>`)}
      ${data.partial ? html`<p role="status">${panelText("Update the manifest provider and refresh to see its modules.")}</p>` : nothing}
      <div class="wp-tools">
        ${westSelectionToolbar(locked, action => this.setSelection(rows, action))}
        <span role="status">${panelText("{0} matched", rows.length)}</span>
        ${this.inactive ? nothing : html`
          <button class="wp-full-update" type="button" @click=${() => this.send("updateWestProjects", { names: [], all: true })}>${panelText("Run a full west update")}</button>
        `}
      </div>
      ${this.discover && !this.inactive ? html`<west-repository-search .scope=${data.scope} .query=${this.query}
        .regex=${this.regex} .known=${projects.map(project => project.name.toLowerCase())}
        .choose=${(repo: GitHubRepository) => this.showForm(repo)}></west-repository-search>` : nothing}
      <div class="west-panes" data-short-list=${this.shorterList(selected.length, available.length) ?? nothing}>
        ${westSelectionPane("wp-selected-title", panelText("Selected modules"), selected.length,
          this.group(selected, panelText("Selected modules"), true), this.inactive ? undefined : html`
            <vscode-button ?disabled=${!selected.length} @click=${() => this.send("updateWestProjects", { names: selected.map(project => project.name) })}>
              ${panelText("Download / update selected ({0})", selected.length)}
            </vscode-button>`)}
        ${westSelectionPane("wp-available-title", panelText("Available modules"), available.length, html`
          ${sources.map(label => {
            const group = visible.filter(project => this.origin(project) === label);
            return group.length ? this.group(group, label) : nothing;
          })}
          ${available.length ? nothing : html`<p class="wp-empty">${panelText("No available modules")}</p>`}`, this.pageControls(page, pages))}
      </div>

    `;
  }

  render() {
    const data = this.catalog;
    const { matches, invalid } = moduleMatcher(this.query, this.regex);
    return html`
      <div class="wp-tools">
        ${moduleSearchBox(this.query, this.regex, value => { this.query = value; this.changePage(0); }, () => { this.regex = !this.regex; this.changePage(0); })}
        ${this.inactive ? nothing : html`
          <button type="button" ?disabled=${!data || !this.query.trim() || invalid}
            @click=${this.searchGitHub}>${panelText("Search GitHub sources")}</button>
          <button type="button" @click=${() => this.showForm()}>${panelText("Add Git repositories")}</button>`}
        <button type="button" ?disabled=${this.checking} @click=${() => this.send("refreshWestProjects", { force: true })}>${this.checking ? panelText("Checking updates…") : panelText("Check for updates")}</button>
        <button type="button" @click=${() => this.send("openWestYml")}>${panelText("Open in Editor")}</button>
      </div>
      ${this.renderRepositoryForm()}
      ${data?.editError ? html`<p role="alert">${data.editError}</p>` : nothing}
      ${invalid ? html`<p role="alert">${panelText("Invalid regular expression")}</p>` : nothing}
      ${this.renderCatalog(data, matches)}
    `;
  }
}
