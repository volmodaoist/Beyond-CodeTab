import { Component, loadPrism, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import { normalizePreviewFenceLanguages } from "../markdown";
import { codeHighlighting } from "./codeHighlighting";
import type { CodeHighlighting } from "./codeHighlighting";
import { normalizeCodeLanguage } from "./codeLanguage";

/**
 * 语言输入只维护本次编辑的选择；保存层负责写回围栏。
 * 高亮准备通过宿主渲染器加载语法，因此尚未在笔记中使用过的语言也能立即着色。
 */
export class CodeLanguageInput extends Component {
  readonly input: HTMLInputElement;
  private revision = 0;
  private timer: number | undefined;
  private disposed = false;

  constructor(
    panel: HTMLElement,
    initialLanguage: string,
    app: App,
    sourcePath: string,
    applyHighlighting: (highlighting: CodeHighlighting) => void
  ) {
    super();
    this.input = panel.ownerDocument.createElement("input");
    this.input.className = "code-tab__language-input";
    this.input.type = "text";
    this.input.value = initialLanguage;
    this.input.placeholder = "text";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "编程语言");
    this.input.title = "编程语言，如 python、javascript、c++；留空使用 text";
    panel.appendChild(this.input);

    const prepareHighlighting = async (language: string, revision: number) => {
      const preview = panel.ownerDocument.createElement("div");
      const renderSession = this.addChild(new Component());
      try {
        // 不插入页面，避免临时预览改变卡片尺寸。使用规范别名，但保存用户选择的语言名。
        const source = normalizePreviewFenceLanguages("```" + language + "\n\n```");
        await MarkdownRenderer.render(app, source, preview, sourcePath, renderSession);
        const prism = await loadPrism();
        const canonicalLanguage = source.split("\n")[0].slice(3);
        // 连续输入时异步加载可能乱序；退出会话或已有新输入后不再应用旧结果。
        if (!this.disposed && revision === this.revision) {
          applyHighlighting(codeHighlighting(prism, canonicalLanguage));
        }
      } catch (error) {
        if (!this.disposed && revision === this.revision) {
          console.warn("Code Tab: failed to load language highlighting", error);
        }
      } finally {
        this.removeChild(renderSession);
      }
    };

    this.registerDomEvent(this.input, "input", () => {
      const language = this.value;
      this.input.setAttribute("aria-invalid", String(language === null));
      const revision = ++this.revision;
      window.clearTimeout(this.timer);
      // 合并连续键入，避免每输入一个字母就请求一套宿主语法。
      if (language !== null) this.timer = window.setTimeout(() => prepareHighlighting(language, revision), 180);
    });
    this.register(() => {
      this.disposed = true;
      window.clearTimeout(this.timer);
      this.input.remove();
    });
  }

  get value(): string | null {
    return normalizeCodeLanguage(this.input.value);
  }
}
