// SPDX-License-Identifier: Apache-2.0
export type Route = "board" | "kconfig" | "device";
export const routes: Route[] = ["board", "kconfig", "device"];

export interface GraphOption {
  id: string;
  label: string;
  group: string;
  type: string;
  value: string;
  choices?: string[];
  visible?: boolean;
  prompt?: string;
}
export interface Catalog {
  route: Route;
  options: GraphOption[];
  files: string[];
  note?: string;
}
export interface DraftView {
  file: string;
  revision: string;
  before: string;
  after: string;
  keys: string[];
}
