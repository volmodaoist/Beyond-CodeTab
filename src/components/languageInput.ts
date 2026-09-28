import { Component } from "obsidian";
import { normalizeCodeLanguage } from "./codeLanguage";

/** 只负责类型输入与校验。预览、着色和保存由编辑会话处理，不在输入事件中渲染临时文档。 */
export class RenderTypeInput extends Component {
  readonly input: HTMLInputElement;
  private timer: number | undefined;

  constructor(panel: HTMLElement, initialType: string, onChange: (renderType: string) => void) {
    super();
    this.input = panel.ownerDocument.createElement("input");
    this.input.className = "code-tab__language-input";
    this.input.setAttribute("data-testid", "code-tab-language");
    this.input.type = "text";
    this.input.value = initialType;
    this.input.placeholder = "text";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", "渲染类型");
    this.input.title = "渲染类型，如 markdown、python、mermaid；支持已安装插件的类型名";
    panel.appendChild(this.input);

    this.registerDomEvent(this.input, "input", () => {
      const renderType = this.value;
      this.input.setAttribute("aria-invalid", String(renderType === null));
      window.clearTimeout(this.timer);
      // 连续输入合并为一次着色更新；真正写回 Markdown 只发生在保存时。
      if (renderType !== null) this.timer = window.setTimeout(() => onChange(renderType), 180);
    });
    this.register(() => {
      window.clearTimeout(this.timer);
      this.input.remove();
    });
  }

  get value(): string | null {
    return normalizeCodeLanguage(this.input.value);
  }
}
