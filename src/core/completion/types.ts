import type { CompletionErrorCode } from "./errors";

export interface CompletionWordEntry {
  readonly label: string;
  readonly insertText?: string;
  readonly detail?: string;
  readonly boost?: number;
}

export type CompletionWord = string | CompletionWordEntry;

export interface CompletionContext {
  readonly documentId: string;
  readonly revision: number;
  readonly text: string;
  readonly offset: number;
  readonly language: string;
  readonly trigger: "automatic" | "explicit";
  readonly signal?: AbortSignal;
}

export interface CompletionItem {
  readonly label: string;
  readonly insertText: string;
  readonly from: number;
  readonly to: number;
  readonly detail?: string;
  readonly boost?: number;
}

export interface CompletionResult {
  readonly documentId: string;
  readonly revision: number;
  readonly registryRevision: number;
  readonly offset: number;
  readonly language: string;
  readonly items: readonly CompletionItem[];
  readonly failures: readonly CompletionFailure[];
}

export interface CompletionFailure {
  readonly ruleId: string;
  readonly message: string;
}

export interface CompletionWordList {
  readonly id: string;
  readonly languages: readonly string[];
  readonly words: readonly CompletionWord[];
}

export interface CompletionRule {
  readonly id: string;
  readonly languages: readonly string[];
  readonly match?: RegExp;
  readonly words?: readonly CompletionWord[];
  readonly complete?: (
    context: CompletionContext,
  ) => readonly CompletionItem[] | Promise<readonly CompletionItem[]>;
}

export interface CompletionRuleConfig extends CompletionWordList {
  readonly match?: string;
  readonly flags?: string;
}

export interface CompletionConfiguration {
  readonly wordLists: readonly CompletionWordList[];
  readonly rules: readonly CompletionRuleConfig[];
}

export interface CompletionRegistration {
  readonly id: string;
  readonly languages: readonly string[];
  readonly kind: "words" | "rule";
}

export interface CompletionEngine {
  readonly errorCodes: Readonly<typeof CompletionErrorCode>;
  readonly languages: readonly string[];
  complete(context: CompletionContext): Promise<CompletionResult>;
  registerWords(list: CompletionWordList): () => void;
  replaceWords(list: CompletionWordList): () => void;
  registerRule(rule: CompletionRule): () => void;
  replaceRule(rule: CompletionRule): () => void;
  unregister(id: string): boolean;
  list(): readonly CompletionRegistration[];
  configure(configuration: CompletionConfiguration): void;
  getRevision(): number;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
