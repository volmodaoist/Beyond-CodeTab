import type { Component } from "obsidian";
import type { CompletionEngine } from "../core/completion";
import type { CodeTabErrorCode } from "./errors";

export interface CodeTabData {
  readonly id?: string;
  readonly title: string;
  readonly content: string;
}

export interface CodeTabRenderOptions {
  container: HTMLElement;
  component: Component;
  id: string;
  source: string;
  sourcePath: string;
  readOnly?: boolean;
  onChange?: (expected: string, next: string | null) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
}

export interface CodeTabUpdate {
  source?: string;
  sourcePath?: string;
  readOnly?: boolean;
}

export interface CodeTabSnapshot {
  readonly source: string;
  readonly revision: number;
  readonly tabs: readonly CodeTabData[];
  readonly activeIndex: number | null;
  readonly readOnly: boolean;
  readonly editing: boolean;
  readonly saving: boolean;
  readonly rendering: boolean;
}

export type CodeTabOperation =
  | { type: "insert-tab"; index: number; tab: CodeTabData }
  | { type: "replace-tab"; index: number; tab: CodeTabData }
  | { type: "remove-tab"; index: number }
  | { type: "move-tab"; fromIndex: number; toIndex: number };

export interface CodeTabApplyOptions {
  expectedRevision: number;
}

export interface CodeTabHandle {
  update(patch: CodeTabUpdate): Promise<void>;
  getSnapshot(): CodeTabSnapshot;
  apply(operations: readonly CodeTabOperation[], options: CodeTabApplyOptions): Promise<void>;
  selectTab(index: number): void;
  focus(target?: "tab" | "content" | "editor"): void;
  startEditing(index?: number): void;
  commit(): Promise<void>;
  cancel(): Promise<void>;
  subscribe(listener: (snapshot: CodeTabSnapshot) => void): () => void;
  dispose(): void;
}

export interface CodeTabApi {
  readonly errorCodes: Readonly<typeof CodeTabErrorCode>;
  readonly completion: CompletionEngine;
  readonly capabilities: readonly string[];
  parse(source: string): readonly CodeTabData[];
  serialize(tabs: readonly CodeTabData[]): string;
  render(options: CodeTabRenderOptions): Promise<CodeTabHandle>;
}

export interface CodeTabApiRequest {
  api?: CodeTabApi;
}
