// SPDX-License-Identifier: Apache-2.0
import { createHash } from "crypto";
import { createReadStream } from "fs";

export async function computeSha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
