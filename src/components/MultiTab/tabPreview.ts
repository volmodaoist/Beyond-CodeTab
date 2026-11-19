import type * as Prism from "prismjs";
import { loadPrism, MarkdownRenderer } from "obsidian";
import type { App, Component } from "obsidian";
import { normalizePreviewFenceLanguages } from "../../markdown";
import { codeHighlighting, mixedCodeHighlighting } from "../CodeBlockEditor";
import type { CodeHighlighting } from "../CodeBlockEditor";
import type CodeTabPlugin from "../../main";
import { readTabContent } from "./tabContent";
import { ExcalidrawFrameDeck } from "./excalidrawFrameDeck";

/** 所有预览统一使用宿主的公开渲染器，保留 Markdown、嵌入及第三方处理器的能力。 */
export async function renderTabPreview(
  plugin: CodeTabPlugin,
  component: Component,
  panel: HTMLElement,
  sourcePath: string,
  source: string,
  stateKeyPrefix: string,
  isCurrent: () => boolean = () => true,
): Promise<CodeHighlighting | null> {
  const app: App = plugin.app;
  const content = readTabContent(source);
  if (content.kind === "markdown") {
    const deckOptions: Parameters<typeof ExcalidrawFrameDeck.create>[0] = {
      app,
      panel,
      sourcePath,
      source: content.editorSource,
      stateKeyPrefix,
      activeFrames: plugin.activeFrames,
    };
    const deck = await ExcalidrawFrameDeck.create(deckOptions);
    if (!isCurrent()) {
      return null;
    }
    if (deck) {
      component.addChild(deck);
      try {
        await deck.initialize();
        return null;
      } catch (error) {
        component.removeChild(deck);
        panel.empty();
        console.warn("Beyond-CodeTab: falling back from Excalidraw Frame Deck", error);
      }
    }
  }

  // 部分语言名在编辑器里能识别，但 MarkdownRenderer 只接受 Prism 的规范别名。
  // 这里只转换交给预览器的副本，用户源文件中的 c++、c# 等写法保持不变。
  const previewSource = normalizePreviewFenceLanguages(content.editorSource);
  await MarkdownRenderer.render(app, previewSource, panel, sourcePath, component);
  if (!isCurrent()) {
    return null;
  }
  if (content.kind !== "code") {
    const prism: typeof Prism = await loadPrism();
    return mixedCodeHighlighting(prism);
  }

  // 普通代码提前准备相同的着色，点击时无需异步等待；图表等处理器仍由宿主生成预览。
  return loadCodeHighlighting(content.renderType);
}

export async function loadCodeHighlighting(renderType: string): Promise<CodeHighlighting> {
  const prism: typeof Prism = await loadPrism();
  const normalized = normalizePreviewFenceLanguages("```" + renderType).slice(3);
  return codeHighlighting(prism, normalized);
}
