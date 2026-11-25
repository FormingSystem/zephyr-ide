// SPDX-License-Identifier: Apache-2.0
import { applyEdits, modify } from "jsonc-parser";
import { mergeFragmentContent } from "../../dashboard_view/kconfig-fragment";
import type { GraphOption } from "./types";

export interface Change {
  option: GraphOption;
  value: string | null;
}

export function confEntries(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(CONFIG_\w+)\s*=\s*(.*?)\s*$/.exec(line);
    const disabled = /^\s*#\s*(CONFIG_\w+)\s+is not set\s*$/.exec(line);
    if (match) {
      values.set(match[1], match[2]);
    }
    if (disabled) {
      values.set(disabled[1], "n");
    }
  }
  return values;
}

export function validateValue(option: GraphOption, value: string) {
  if (/[\r\n\0]/.test(value) || (option.choices && !option.choices.includes(value))) {
    return false;
  }
  switch (option.type) {
    case "int":
      return /^-?\d+$/.test(value);
    case "hex":
      return /^0x[\da-f]+$/i.test(value);
    case "cell":
      return /^(0x[\da-f]+|\d+)$/i.test(value) && Number(value) <= 0xffffffff;
    default:
      return true;
  }
}

function editConfig(text: string, changes: Change[]) {
  const pending = new Map(changes.map((c) => [c.option.id, c]));
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const output = text
    .split(/(?<=\n)/)
    .flatMap((line) => {
      const key = confEntries(line).keys().next().value;
      const change = key && pending.get(key);
      if (!change) {
        return [line];
      }
      if (change.value === null) {
        return [];
      }
      return [configLine(change) + (line.match(/\r?\n$/)?.[0] ?? "")];
    })
    .join("");
  const existing = confEntries(text);
  const extra = changes.filter((c) => c.value !== null && !existing.has(c.option.id)).map(configLine);
  return extra.length ? output + (output && !output.endsWith("\n") ? eol : "") + extra.join(eol) + eol : output;
}

function configLine({ option, value }: Change) {
  return mergeFragmentContent("", [{ name: option.id, type: option.type, value: value! }]).trim();
}

function editOverlay(text: string, changes: Change[]) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  for (const { option, value } of changes) {
    const marker = "/* Zephyr IDE: " + option.group + " " + option.label + " */";
    const start = text.split(/\r?\n/).indexOf(marker);
    const literal = option.type === "cell" ? "<" + value + ">" : JSON.stringify(value);
    const statement =
      option.type === "flag"
        ? value === "y"
          ? option.label
          : "/delete-property/ " + option.label
        : option.label + " = " + literal;
    const block = marker + eol + "&{" + option.group + "} { " + statement + "; };";
    const lines = text.split(/\r?\n/);
    if (start >= 0 && lines[start + 1]?.startsWith("&{" + option.group + "} { ") && lines[start + 1].endsWith("; };")) {
      lines.splice(start, 2, block);
      text = lines.join(eol);
    } else {
      text += (text && !text.endsWith("\n") ? eol : "") + block + eol;
    }
  }
  return text;
}

export const visualPreset = "zephyr-ide-visual";

function boardPreset(text: string, target: string) {
  const input = text || '{\n  "version": 3,\n  "configurePresets": []\n}\n';
  const document = JSON.parse(input);
  const presets = document.configurePresets ?? [];
  const index = presets.findIndex((item: { name: string }) => item.name === visualPreset);
  const options = {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: input.includes("\r\n") ? "\r\n" : "\n" },
  };
  const binaryDir = "${sourceDir}/build/${presetName}-" + target.replace(/[^\w.-]/g, "-");
  if (index >= 0) {
    const preset = presets[index];
    const key = ["configurePresets", index, "cacheVariables", "BOARD"];
    if (preset.cacheVariables?.BOARD && typeof preset.cacheVariables.BOARD === "object") {
      key.push("value");
    }
    const updated = applyEdits(input, modify(input, key, target, options));
    if (!preset.binaryDir?.startsWith("${sourceDir}/build/${presetName}-")) {
      return updated;
    }
    return applyEdits(updated, modify(updated, ["configurePresets", index, "binaryDir"], binaryDir, options));
  }
  const preset = { name: visualPreset, generator: "Ninja", binaryDir, cacheVariables: { BOARD: target } };
  return applyEdits(input, modify(input, ["configurePresets", -1], preset, options));
}

export function renderChanges(text: string, route: string, changes: Change[]): string {
  if (text.startsWith("\uFEFF")) {
    return "\uFEFF" + renderChanges(text.slice(1), route, changes);
  }
  if (!changes.length) {
    return text;
  }
  if (route === "board") {
    return boardPreset(text, changes[changes.length - 1].value!);
  }
  return route === "device" ? editOverlay(text, changes) : editConfig(text, changes);
}
