// SPDX-License-Identifier: Apache-2.0

/** Keep the original line number so validation can point back into a pasted list. */
export function repositoryAddresses(text: string) {
  return text.split(/\r\n|[\r\n]/).map((line, i) => ({ url: line.trim(), number: i + 1 })).filter(line => line.url.length > 0);
}
