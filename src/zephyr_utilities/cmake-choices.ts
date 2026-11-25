// SPDX-License-Identifier: Apache-2.0
export const guidedKeys = ["BOARD", "ZEPHYR_BASE"] as const;
export type GuidedKey = typeof guidedKeys[number];
export type CMakeChoices = Partial<Record<GuidedKey, string>>;

/** Match typed CMake cache definitions, including an explicitly empty value. */
export function explicitChoice(text: string, key: GuidedKey): string | undefined {
  const pattern = new RegExp("^\\s*" + key + "(?::[A-Za-z]+)?\\s*=\\s*(.*)$");
  for (const line of text.split(/\r?\n/).reverse()) {
    const match = pattern.exec(line);
    if (match) { return match[1].trim(); }
  }
}

/** Supplement the command input. Persist the user's text separately. */
export function effectiveDefinitions(text: string, choices: CMakeChoices) {
  const additions: string[] = [];
  for (const key of guidedKeys) {
    const value = choices[key];
    if (typeof value === "string" && value && !/[\r\n\0]/.test(value) && explicitChoice(text, key) === undefined) {
      additions.push(key + "=" + value);
    }
  }
  return [text, ...additions].join("\n");
}
