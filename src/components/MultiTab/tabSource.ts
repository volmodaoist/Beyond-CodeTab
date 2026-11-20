import { MarkdownView } from "obsidian";
import type { App, EditorPosition, OpenViewState } from "obsidian";
import { findTabBlock } from "../../markdown";

/** 整组源码交给原生笔记编辑器，保存和撤销沿用 Obsidian。 */
export async function openTabSource(
  app: App,
  element: HTMLElement,
  sourcePath: string,
  source: string,
  line: number,
): Promise<void> {
  const file = app.vault.getFileByPath(sourcePath);
  if (!file) {
    throw new Error("无法定位当前笔记");
  }
  const text = await app.vault.read(file);
  const block = findTabBlock(text, source, line);
  if (!block) {
    throw new Error("原标签块已发生变化，请刷新笔记后重试");
  }
  const current = app.workspace.getActiveViewOfType(MarkdownView);
  if (current?.file?.path === sourcePath && current.containerEl.contains(element)) {
    const nativeButton = element
      .closest(".cm-embed-block, .cm-preview-code-block")
      ?.querySelector<HTMLButtonElement>(
        ":scope > .embed-actions > .edit-block-button, :scope > .edit-block-button",
      );
    if (nativeButton) {
      nativeButton.click();
      return;
    }
  }
  const state: Record<string, string> = {
    mode: "source",
  };
  const viewState: OpenViewState = {
    active: true,
    state,
  };
  await app.workspace.openLinkText(file.path, "", false, viewState);
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  if (!view || view.file?.path !== file.path || view.getMode() !== "source") {
    throw new Error("无法打开标签组源码");
  }
  const position: EditorPosition = {
    line: block.line + 1,
    ch: 0,
  };
  view.editor.setCursor(position);
  view.editor.focus();
}
