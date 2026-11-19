import {
  autocompletion,
  closeCompletion,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext as EditorCompletionContext,
  CompletionResult as EditorCompletionResult,
} from "@codemirror/autocomplete";
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { CompletionError, normalizeCompletionLanguage } from "../../core/completion";
import type { CompletionContext, CompletionEngine } from "../../core/completion";
import { findCodeBlockBody } from "./fences";
import { findFencedCodeRanges } from "./fencedCodeRanges";
import type { CodeRange } from "./fencedCodeRanges";

let sequence = 0;

/** 用正文范围隔离补全；保留原生 Markdown 解析和围栏保护。 */
export function codeCompletionExtensions(
  engine: CompletionEngine,
  languageOverride?: () => string,
): Extension[] {
  const token = "code-tab-completion-" + ++sequence;
  const locate = (text: string, offset: number): CodeRange | undefined => {
    if (languageOverride) {
      const body = findCodeBlockBody(text);
      if (!body || offset < body.from || offset > body.to) {
        return undefined;
      }
      const range: CodeRange = {
        from: body.from,
        to: body.to,
        language: languageOverride(),
      };
      return range;
    }
    return findFencedCodeRanges(text).find((range) => offset >= range.from && offset <= range.to);
  };
  const session = ViewPlugin.fromClass(
    class {
      revision = 0;
      request: AbortController | null = null;
      timer: number | null = null;
      unsubscribe: () => void;

      constructor(readonly view: EditorView) {
        view.contentDOM.setAttribute("data-code-tab-completion", token);
        view.contentDOM.addEventListener("blur", this.onBlur);
        this.unsubscribe = engine.subscribe(() => {
          const active = completionStatus(view.state) !== null;
          this.request?.abort();
          closeCompletion(view);
          if (active && !view.composing) {
            startCompletion(view);
          }
        });
      }

      onBlur = (): void => {
        const win = this.view.dom.ownerDocument.defaultView;
        if (!win) {
          return;
        }
        if (this.timer !== null) {
          win.clearTimeout(this.timer);
        }
        this.timer = win.setTimeout(() => {
          this.timer = null;
          const active = this.view.dom.ownerDocument.activeElement;
          if (active && (this.view.dom.contains(active) || active.closest("." + token))) {
            return;
          }
          closeCompletion(this.view);
        }, 120);
      };

      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.revision += 1;
        }
        if (update.docChanged || update.selectionSet) {
          this.request?.abort();
        }
      }

      destroy(): void {
        this.request?.abort();
        this.unsubscribe();
        this.view.contentDOM.removeEventListener("blur", this.onBlur);
        this.view.contentDOM.removeAttribute("data-code-tab-completion");
        if (this.timer !== null) {
          this.view.dom.ownerDocument.defaultView?.clearTimeout(this.timer);
        }
      }
    },
  );
  const source = async (
    context: EditorCompletionContext,
  ): Promise<EditorCompletionResult | null> => {
    const view = context.view;
    const owner = view?.plugin(session);
    if (!view || !owner || view.composing) {
      return null;
    }
    const document = context.state.doc;
    const text = document.toString();
    const range = locate(text, context.pos);
    if (!range) {
      return null;
    }
    owner.request?.abort();
    const abort = new AbortController();
    owner.request = abort;
    const request: CompletionContext = {
      documentId: token,
      revision: owner.revision,
      text: text.slice(range.from, range.to),
      offset: context.pos - range.from,
      language: range.language,
      trigger: context.explicit ? "explicit" : "automatic",
      signal: abort.signal,
    };
    try {
      const candidates = await engine.complete(request);
      if (
        abort.signal.aborted ||
        view.state.doc !== document ||
        owner.revision !== request.revision
      ) {
        return null;
      }
      const options: Completion[] = candidates.items.map((item) => {
        const completion: Completion = {
          label: item.label,
          detail: item.detail,
          boost: item.boost,
          type: "text",
          apply: (editor) => {
            const current = locate(editor.state.doc.toString(), editor.state.selection.main.head);
            if (
              abort.signal.aborted ||
              editor.state.doc !== document ||
              editor.state.selection.main.head !== context.pos ||
              !current ||
              normalizeCompletionLanguage(current.language) !== candidates.language ||
              current.from !== range.from ||
              engine.getRevision() !== candidates.registryRevision
            ) {
              closeCompletion(editor);
              return;
            }
            const changes: NonNullable<TransactionSpec["changes"]> = {
              from: range.from + item.from,
              to: range.from + item.to,
              insert: item.insertText,
            };
            const selection: NonNullable<TransactionSpec["selection"]> = {
              anchor: range.from + item.from + item.insertText.length,
            };
            const transaction: TransactionSpec = {
              changes,
              selection,
              userEvent: "input.complete",
            };
            editor.dispatch(transaction);
            closeCompletion(editor);
            editor.focus();
          },
        };
        return completion;
      });
      if (!options.length) {
        return null;
      }
      const result: EditorCompletionResult = {
        from: range.from + Math.min(...candidates.items.map((item) => item.from)),
        options,
      };
      return result;
    } catch (error) {
      if (!(error instanceof CompletionError)) {
        console.error("Code Tab: completion source failed", error);
      }
      return null;
    }
  };
  const config: Parameters<typeof autocompletion>[0] = {
    override: [source],
    activateOnTyping: true,
    closeOnBlur: false,
    tooltipClass: () => "code-tab__completion-tooltip " + token,
  };
  return [session, autocompletion(config)];
}

export function isCodeCompletionInteraction(view: EditorView, target: EventTarget | null): boolean {
  const token = view.contentDOM.getAttribute("data-code-tab-completion");
  const element = target as Element | null;
  return !!token && !!element?.closest?.("." + token);
}
