import { loadPrism, MarkdownRenderer } from "obsidian";
import type { App, Component } from "obsidian";
import type * as Prism from "prismjs";
import { normalizePreviewFenceLanguages } from "../markdown";
import { codeHighlighting } from "./codeHighlighting";
import type { CodeHighlighting } from "./codeHighlighting";
import { readTabContent } from "./tabContent";

/** 所有预览统一使用宿主的公开渲染器，保留 Markdown、嵌入及第三方处理器的能力。 */
export async function renderTabPreview(
  app: App, component: Component, panel: HTMLElement, sourcePath: string, source: string
): Promise<CodeHighlighting | null> {
  const content = readTabContent(source);
  // 部分语言名在编辑器里能识别，但 MarkdownRenderer 只接受 Prism 的规范别名。
  // 这里只转换交给预览器的副本，用户源文件中的 c++、c# 等写法保持不变。
  const previewSource = normalizePreviewFenceLanguages(content.editorSource);
  await MarkdownRenderer.render(app, previewSource, panel, sourcePath, component);
  if (content.kind !== "code") return null;

  // 普通代码提前准备相同的着色，点击时无需异步等待；图表等处理器仍由宿主生成预览。
  return loadCodeHighlighting(content.renderType);
}

export async function loadCodeHighlighting(renderType: string): Promise<CodeHighlighting> {
  const prism: typeof Prism = await loadPrism();
  const normalized = normalizePreviewFenceLanguages("```" + renderType).slice(3);
  return codeHighlighting(prism, normalized);
}
