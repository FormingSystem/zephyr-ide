// SPDX-License-Identifier: Apache-2.0
import { promises as fs, createReadStream } from "fs";
import { createHash, randomUUID } from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { executeShellCommandInPythonEnv } from "../utilities/utils";
import type { WorkspaceConfig } from "./types";

/** Publish only bytes matching the digest declared by the current module. */
export async function copyVerifiedBlob(source: string, destination: string, digest: string) {
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const temporary = path.join(parent, ".blob-" + randomUUID());
  try {
    await fs.copyFile(source, temporary);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(temporary)) { hash.update(chunk); }
    if (hash.digest("hex") !== digest.toLowerCase()) {
      throw Error(vscode.l10n.t("The selected file does not match the declared SHA-256."));
    }
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function importLocalBlob(workspace: WorkspaceConfig) {
  const setup = workspace.activeSetupState;
  if (!setup || !vscode.workspace.isTrusted) { return; }
  const command = 'west blobs list -f "{module}\t{status}\t{path}\t{sha256}\t{abspath}"';
  const result = await executeShellCommandInPythonEnv(command, setup.setupPath, setup);
  if (!result.stdout) { return; }
  const blobs = result.stdout.split(/\r?\n/).flatMap(line => {
    const [module, status, name, digest, destination] = line.split("\t");
    if (status === "A" || !destination || !path.isAbsolute(destination) || !/^[a-f\d]{64}$/i.test(digest)) { return []; }
    return [{ label: name, description: module, digest, destination }];
  });
  if (!blobs.length) {
    await vscode.window.showInformationMessage(vscode.l10n.t("All declared blobs match their checksums."));
    return;
  }
  const blob = await vscode.window.showQuickPick(blobs, { title: vscode.l10n.t("Select the declared blob to import") });
  if (!blob) { return; }
  const source = await vscode.window.showOpenDialog({ canSelectMany: false, title: blob.label });
  if (source?.length) { await copyVerifiedBlob(source[0].fsPath, blob.destination, blob.digest); }
}
