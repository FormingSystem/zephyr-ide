// SPDX-License-Identifier: Apache-2.0
import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ZephyrLitElement } from "../../webview_shared/lit-base";
import { panelText as t } from "../../webview_shared/panel-text";
import { moduleMatcher } from "../../webview_shared/module-search";
import type { GitHubRepository } from "../../../setup_utilities/github-repositories";

@customElement("west-repository-search")
export class WestRepositorySearch extends ZephyrLitElement {
  @property() query = "";
  @property({ type: Boolean }) regex = false;
  @property() scope = "";
  @property({ attribute: false }) known: string[] = [];
  @property({ attribute: false }) choose!: (repo: GitHubRepository) => void;
  @state() private owner = "zephyrproject-rtos";
  @state() private items: GitHubRepository[] = [];
  @state() private globalResults = false;
  @state() private busy = false;
  @state() private error = "";
  private source = "";
  private requestId = 0;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("message", this.receive);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("message", this.receive);
  }
  private receive = ({ data }: MessageEvent) => {
    if (data.command !== "githubRepositoryResults" || data.scope !== this.scope || data.id !== this.requestId) { return; }
    this.items = data.items ?? [];
    this.error = data.error ?? "";
    this.busy = false;
  };
  private get repositoryQuery() {
    if (!this.regex) {
      const link = /^(?:https:\/\/github\.com\/)?([a-z\d-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(this.query.trim());
      if (link) { return { owner: link[1], name: link[2] }; }
    }
    return { owner: this.owner, name: this.query.trim() };
  }
  protected updated(changes: PropertyValues) {
    if (!this.query.trim()) { return; }
    if (changes.has("scope") || changes.has("owner") ||
        this.source !== this.scope + ":" + this.repositoryQuery.owner) {
      if (!this.globalResults || changes.has("query") || changes.has("regex")) { this.runSearch(); }
    }
  }
  public runSearch() { this.search(false); }
  private search(global: boolean) {
    this.globalResults = global;
    this.source = global ? "" : this.scope + ":" + this.repositoryQuery.owner;
    this.items = [];
    this.error = "";
    this.busy = true;
    this.vscodeApi.postMessage({ command: "searchGitHubRepositories", id: ++this.requestId,
      scope: this.scope, owner: this.repositoryQuery.owner, query: global ? this.repositoryQuery.name : undefined });
  }
  render() {
    if (!this.query.trim()) { return nothing; }
    const { matches, invalid } = moduleMatcher(this.repositoryQuery.name, this.regex);
    if (invalid) { return nothing; }
    const repos = this.items.filter(r => matches(r.full_name.split("/")[1])
      && !this.known.includes(r.full_name.split("/")[1].toLowerCase()))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "en"));
    return html`<section aria-label="GitHub" class="wp-discovery">
      <div class="wp-tools"><strong>GitHub</strong>
        <label>${t("Owner")} <input aria-label=${t("GitHub owner")} .value=${this.repositoryQuery.owner}
          @change=${(e: Event) => { this.owner = (e.target as HTMLInputElement).value.trim(); }}></label>
        <button @click=${() => this.search(false)}>${t("Search owner")}</button>
        <button ?disabled=${this.regex} @click=${() => this.search(true)}>${t("Search GitHub by name")}</button>
      </div>
      ${this.busy ? html`<p role="status">${t("Searching GitHub…")}</p>` : this.error ? html`<p role="alert">${this.error}</p>`
        : repos.length ? html`<div class="wp-remote-results">${repos.map(repo => html`<div class="wp-row">
          <span>${repo.full_name}</span><button type="button" aria-label=${t("Add {0}", repo.full_name)}
            @click=${() => this.choose(repo)}>${t("Add repository")}…</button></div>`)}</div>`
        : html`<p class="wp-empty">${t("No additional repositories matched.")}</p>`}
    </section>`;
  }
}
