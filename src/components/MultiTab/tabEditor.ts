import { Component } from "obsidian";
import type { App } from "obsidian";
import { Compartment, EditorSelection, StateEffect } from "@codemirror/state";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type {
  AppWithEmbedRegistry,
  MarkdownEmbedContext,
  MarkdownEmbedOptions,
  NativeMarkdownEmbed,
} from "./types";
import { codeBlockEditorExtensions } from "../CodeBlockEditor";
import type { CodeHighlighting } from "../CodeBlockEditor";
import { RenderTypeInput } from "./renderTypeInput";
import { readTabContent, writeTabContent } from "./tabContent";
import type { TabContent } from "./tabContent";
import { loadCodeHighlighting } from "./tabPreview";

export interface TabEditorOptions {
  app: App;
  panel: HTMLElement;
  sourcePath: string;
  source: string;
  highlighting: CodeHighlighting | null;
  click: MouseEvent;
  addButton: HTMLElement;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * 一次临时编辑会话，只负责输入、类型选择和资源释放，不读写 Vault。
 * 标签组在保存成功后卸载会话；失败时保留当前编辑器，让用户继续编辑或重试。
 */
export class TabEditor extends Component {
  private readonly content: TabContent;
  private readonly host: HTMLDivElement;
  private readonly highlightingSlot = new Compartment();
  private native: NativeMarkdownEmbed | null = null;
  private fallback: HTMLTextAreaElement | null = null;
  private typeInput: RenderTypeInput | null = null;
  private highlighting: CodeHighlighting | null;
  private disposed = false;
  private pointerX: number;
  private pointerY: number;

  constructor(private readonly options: TabEditorOptions) {
    super();
    this.content = readTabContent(options.source);
    this.highlighting = options.highlighting;
    this.pointerX = options.click.clientX;
    this.pointerY = options.click.clientY;
    this.host = options.panel.ownerDocument.createElement("div");
    this.host.className = "code-tab__native-editor is-" + this.content.kind + "-content";
    this.host.setAttribute("data-testid", "code-tab-editor");
  }

  onload() {
    this.options.panel.appendChild(this.host);
    this.setHighlightingClass();
    try {
      this.createNativeEditor();
    } catch (error) {
      console.warn("Code Tab: native Markdown editor unavailable, using fallback", error);
      if (this.native) {
        this.removeChild(this.native);
      }
      this.native = null;
      this.createFallbackEditor();
    }

    this.typeInput = this.addChild(
      new RenderTypeInput(this.options.panel, this.content.renderType, (type) =>
        this.updateHighlighting(type),
      ),
    );
    this.registerDomEvent(this.typeInput.input, "keydown", (event) => {
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        if (this.typeInput?.value !== null) {
          this.focus();
        }
      }
    });
    this.registerInputEvents();
    window.requestAnimationFrame(() => {
      if (this.disposed) {
        return;
      }
      // 用户可能在初始化的这一帧已点入类型框，不能再把焦点抢回正文。
      if (this.options.panel.ownerDocument.activeElement !== this.typeInput?.input) {
        this.focus();
      }
      this.options.panel.classList.remove("is-restoring");
      this.options.panel.style.removeProperty("--code-tab-restore-height");
    });
  }

  onunload() {
    this.disposed = true;
    this.host.remove();
  }

  /** 原生编辑器和 textarea 对外暴露同一份完整标签正文。 */
  getValue(): string {
    const renderType = this.typeInput ? this.typeInput.value : this.content.renderType;
    if (renderType === null) {
      this.typeInput?.input.focus();
      throw new Error("渲染类型不能包含空白、反引号或波浪号");
    }
    let edited =
      this.native?.editor?.getValue() ?? this.fallback?.value ?? this.content.editorSource;
    if (this.fallback && this.content.kind === "code" && this.content.body) {
      // textarea 只显示代码正文；恢复原围栏后与原生编辑器共用格式转换逻辑。
      const body = this.content.body;
      edited =
        this.content.source.slice(0, body.from) + edited + this.content.source.slice(body.to);
    }
    return writeTabContent(this.content, edited, renderType);
  }

  focus() {
    if (this.native?.editor) {
      this.native.editor.focus();
    } else {
      this.fallback?.focus();
    }
  }

  private createNativeEditor() {
    const registry = (this.options.app as AppWithEmbedRegistry).embedRegistry;
    const embedOptions: MarkdownEmbedOptions = {
      extension: "md",
    };
    const create = registry?.getEmbedCreator(embedOptions);
    if (!create) {
      throw new Error("Markdown embed editor unavailable");
    }
    const context: MarkdownEmbedContext = {
      app: this.options.app,
      linktext: null,
      sourcePath: this.options.sourcePath,
      containerEl: this.host,
      displayMode: false,
      showInline: false,
      depth: 0,
    };
    this.native = this.addChild(create(context, null));
    this.native.editable = true;
    this.native.showEditor();
    const editor = this.native.editor;
    if (!editor) {
      throw new Error("Markdown editor was not initialized");
    }
    editor.setValue(this.content.editorSource);
    const view = editor.cm;
    if (!view) {
      return;
    }

    // 只标记外层编辑器。表格单元格和嵌入内容可能还有自己的 CodeMirror，不能一起套代码样式。
    // 根节点的 class 由 CodeMirror 在每次更新时重建，必须通过扩展声明，不能直接 add。
    const editorAttributes = (editorView: EditorView): Record<string, string> => {
      const doc = editorView.state.doc;
      // 表格前后会出现不对应正文的空光标行。用真实文档区分占位行和可输入的空行，
      // 避免初始化从外层编辑器转入单元格时，因焦点变化让占位行短暂撑高面板。
      // 方向键离开表格时，宿主会插入真实空行；文档更新会同步恢复该行的高度。
      const attributes: Record<string, string> = {
        class: "code-tab__cm-root",
        "data-leading-blank-line": String(doc.line(1).length === 0),
        "data-trailing-blank-line": String(doc.line(doc.lines).length === 0),
      };
      return attributes;
    };
    const extensions: Extension[] = [EditorView.editorAttributes.of(editorAttributes)];
    view.scrollDOM.classList.add("code-tab__cm-scroller");
    view.contentDOM.classList.add("code-tab__cm-content");
    view.contentDOM.parentElement?.classList.add("code-tab__cm-container");
    view.contentDOM.closest(".cm-sizer")?.classList.add("code-tab__cm-sizer");

    if (this.content.kind === "code" && this.content.body) {
      extensions.push(...codeBlockEditorExtensions());
      extensions.push(this.highlightingSlot.of(this.highlighting?.extension ?? []));
    }
    const transaction: TransactionSpec = {
      effects: StateEffect.appendConfig.of(extensions),
      selection:
        this.content.kind === "code" && this.content.body
          ? EditorSelection.single(this.content.body.from)
          : undefined,
    };
    view.dispatch(transaction);
  }

  private createFallbackEditor() {
    this.host.empty();
    this.fallback = this.host.ownerDocument.createElement("textarea");
    this.fallback.className = "code-tab__fallback-editor";
    this.fallback.setAttribute("data-testid", "code-tab-fallback");
    const body = this.content.body;
    this.fallback.value =
      this.content.kind === "code" && body
        ? this.content.source.slice(body.from, body.to)
        : this.content.editorSource;
    this.fallback.spellcheck = false;
    this.fallback.rows = 1;
    this.host.appendChild(this.fallback);
    const resize = () => {
      if (!this.fallback) {
        return;
      }
      // 先归零再测量，让新增和删除行都能同步改变高度，中间状态不会被绘制。
      this.fallback.style.height = "0";
      this.fallback.style.height = this.fallback.scrollHeight + "px";
    };
    this.registerDomEvent(this.fallback, "input", resize);
    resize();
  }

  private setHighlightingClass() {
    this.host.classList.toggle("has-prism-highlighting", !!this.highlighting);
    if (this.highlighting?.language) {
      this.host.classList.add("language-" + this.highlighting.language);
    }
  }

  private async updateHighlighting(renderType: string) {
    // Markdown 继续使用宿主的实时预览；类型变化在保存时转换格式。
    if (this.content.kind !== "code") {
      return;
    }
    const highlighting = await loadCodeHighlighting(renderType);
    if (this.disposed || this.typeInput?.value !== renderType) {
      return;
    }
    if (this.highlighting?.language) {
      this.host.classList.remove("language-" + this.highlighting.language);
    }
    this.highlighting = highlighting;
    this.setHighlightingClass();
    const transaction: TransactionSpec = {
      effects: this.highlightingSlot.reconfigure(highlighting.extension),
    };
    this.native?.editor?.cm?.dispatch(transaction);
  }

  private registerInputEvents() {
    const panel = this.options.panel;
    const editorWindow = panel.ownerDocument.defaultView;
    const keydown = (event: KeyboardEvent) => {
      if (!event.composedPath().includes(panel)) {
        return;
      }
      if (event.key !== "Escape" && !(event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        this.options.onCancel();
      } else {
        this.options.onSave();
      }
    };
    // 与宿主全局 keymap 一样在窗口捕获阶段处理，正文、表格单元格和类型框都能保存/取消。
    editorWindow?.addEventListener("keydown", keydown, true);
    this.register(() => editorWindow?.removeEventListener("keydown", keydown, true));
    this.registerDomEvent(panel.ownerDocument, "mousemove", (event) => {
      const moved = event.clientX !== this.pointerX || event.clientY !== this.pointerY;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      const path = event.composedPath();
      // 布局变化不算主动移出；移向 + 时由新增动作按顺序保存当前编辑。
      if (moved && !path.includes(panel) && !path.includes(this.options.addButton)) {
        this.options.onSave();
      }
    });
  }
}
