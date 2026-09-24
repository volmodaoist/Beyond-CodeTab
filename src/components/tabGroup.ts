import { MarkdownRenderer, Notice } from "obsidian";
import type { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import type CodeTabPlugin from "../main";
import type { AppWithEmbedRegistry, NativeMarkdownEmbed } from "./types";
import {
  normalizeNewlines, normalizePreviewFenceLanguages, parseTabs, safeId,
  serializeTabs, updateMarkdownSource,
} from "../markdown";

function getGroupInfo(context: MarkdownPostProcessorContext, element: HTMLElement) {
  const section = context.getSectionInfo(element);
  // 行号既用于区分同一文件中的多个 tab 块，也用于保存时选择最接近的匹配项。
  return {
    id: context.sourcePath + ":" + (section ? section.lineStart : 0),
    lineStart: section ? section.lineStart : 0,
  };
}

export function renderTabGroup(
  plugin: CodeTabPlugin, component: MarkdownRenderChild, element: HTMLElement,
  context: MarkdownPostProcessorContext, initialSource: string
) {
  // source 不含最外层 ```tab fence，只包含各标签的声明和正文。
  let source = normalizeNewlines(initialSource);
  let tabs = parseTabs(source);
  const group = getGroupInfo(context, element);

  element.empty();
  element.addClass("code-tab");

  if (tabs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "code-tab__empty";
    empty.textContent = "未找到标签。请使用 tab: 标题 声明标签。";
    element.appendChild(empty);
    return;
  }

  const groupSuffix = safeId(group.id);
  const tabList = document.createElement("div");
  tabList.className = "code-tab__list";
  tabList.setAttribute("role", "tablist");
  element.appendChild(tabList);

  const panels = document.createElement("div");
  panels.className = "code-tab__panels";
  element.appendChild(panels);

  const buttons: HTMLButtonElement[] = [];
  const panelElements: HTMLDivElement[] = [];
  // 只在当前笔记打开期间记住选中的标签，不向 Markdown 写入额外状态。
  let activeIndex = Math.min(plugin.activeTabs.get(group.id) || 0, tabs.length - 1);
  let editingIndex = -1;

  const activate = (index: number, focus = false) => {
    // 编辑中不允许直接切换标签，否则鼠标点击会先销毁当前编辑器并丢失未保存内容。
    if (editingIndex >= 0 && editingIndex !== index) return;

    activeIndex = index;
    plugin.activeTabs.set(group.id, index);

    buttons.forEach((button, buttonIndex) => {
      const active = buttonIndex === index;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("tabindex", active ? "0" : "-1");
      panelElements[buttonIndex].hidden = !active;
    });

    if (focus) buttons[index].focus();
  };

  const renderPanel = async (index: number) => {
    const panel = panelElements[index];
    panel.empty();
    panel.classList.remove("is-editing");
    // 浏览态始终走公开 API；它比完整 embed editor 更轻，也天然支持链接、列表和代码块。
    // 部分语言名在编辑器里能识别，但 MarkdownRenderer 只接受 Prism 的规范别名。
    // 这里只转换交给预览器的副本，用户源文件中的 c++、c# 等写法保持不变。
    const previewSource = normalizePreviewFenceLanguages(tabs[index].content);
    await MarkdownRenderer.render(plugin.app, previewSource, panel, context.sourcePath, component);
  };

  const startEditing = (index: number) => {
    // 一个 tab 组件同一时间只维护一个编辑会话。
    if (editingIndex >= 0) return;
    activate(index);
    editingIndex = index;
    element.addClass("is-editing");

    const panel = panelElements[index];
    const originalContent = tabs[index].content;
    const previewHeight = panel.getBoundingClientRect().height;
    let saving = false;
    let editorView: NativeMarkdownEmbed | null = null;
    let editorDom: HTMLElement | null = null;
    let fallbackTextarea: HTMLTextAreaElement | null = null;
    panel.empty();
    panel.addClass("is-editing");

    const editorHost = document.createElement("div");
    editorHost.className = "code-tab__native-editor";
    // 至少维持浏览态高度，避免点击后布局突然收缩再弹开。
    editorHost.style.minHeight = Math.max(128, previewHeight) + "px";
    panel.appendChild(editorHost);

    const getEditorValue = () => {
      // 原生编辑器和降级 textarea 对保存层暴露相同的字符串接口。
      if (editorView && editorView.editor) return editorView.editor.getValue();
      return fallbackTextarea ? fallbackTextarea.value : originalContent;
    };

    const destroyEditor = () => {
      if (editorDom) editorDom.removeEventListener("keydown", handleEditorKeydown);
      if (!editorView) return;
      try {
        // 动态创建的子组件必须及时卸载，避免关闭标签后仍保留编辑器监听器。
        component.removeChild(editorView);
      } catch (error) {
        console.warn("Code Tab: failed to unload native Markdown editor", error);
      }
      editorView = null;
      editorDom = null;
    };

    const leaveEditor = async () => {
      // 先解绑手工注册的事件，再卸载原生组件，最后恢复轻量预览。
      panel.removeEventListener("mouseleave", save);
      if (fallbackTextarea) {
        fallbackTextarea.removeEventListener("keydown", handleEditorKeydown);
      }
      destroyEditor();
      editingIndex = -1;
      element.removeClass("is-editing");
      if (panel.isConnected) await renderPanel(index);
    };

    const cancel = async () => {
      // Esc 只退出本次会话，不触碰文件，也不改变内存中的标签内容。
      tabs[index].content = originalContent;
      await leaveEditor();
    };

    const save = async () => {
      if (editingIndex !== index || saving) return;
      saving = true;

      const nextContent = getEditorValue().replace(/^\n+|\n+$/g, "");
      // 鼠标移出同样会触发保存；内容未变化时直接退出，避免无意义地改写文件。
      if (nextContent === originalContent) {
        await leaveEditor();
        return;
      }

      const nextTabs = tabs.map((tab, tabIndex) => ({
        // 创建新数组而不是原地修改；只有文件写入成功后才提交到内存状态。
        title: tab.title,
        content: tabIndex === index ? nextContent : tab.content,
      }));
      const nextSource = serializeTabs(nextTabs);

      try {
        // 先安全写回源文件，再更新预览使用的 source/tabs，避免失败时 UI 假装已保存。
        await updateMarkdownSource(plugin.app, context.sourcePath, group.lineStart, source, nextSource);
        tabs = nextTabs;
        source = nextSource;
        await leaveEditor();
      } catch (error) {
        console.error("Code Tab: failed to save tab content", error);
        new Notice(error instanceof Error ? error.message : "标签内容保存失败", 5000);
        saving = false;
      }
    };

    function handleEditorKeydown(event: KeyboardEvent) {
      // Esc 是明确的“放弃”，Cmd/Ctrl+Enter 是无需移开鼠标的主动保存快捷键。
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      }
    }

    const createFallbackEditor = () => {
      // 私有 embed API 在未来版本失效时，至少保留一个始终可见、可保存的编辑入口。
      editorHost.empty();
      fallbackTextarea = document.createElement("textarea");
      fallbackTextarea.className = "code-tab__fallback-editor";
      fallbackTextarea.value = originalContent;
      fallbackTextarea.spellcheck = false;
      fallbackTextarea.style.minHeight = Math.max(128, previewHeight) + "px";
      fallbackTextarea.addEventListener("keydown", handleEditorKeydown);
      editorHost.appendChild(fallbackTextarea);
      window.requestAnimationFrame(() => fallbackTextarea?.focus());
    };

    try {
      // 仅在用户点击时懒加载原生 Markdown 编辑器；离开后立即销毁，避免旧版常驻 embed 的臃肿布局。
      const embedRegistry = (plugin.app as AppWithEmbedRegistry).embedRegistry ||
        (window as Window & { app?: AppWithEmbedRegistry }).app?.embedRegistry;
      const embedCreator = embedRegistry && embedRegistry.getEmbedCreator({ extension: "md" });
      if (typeof embedCreator !== "function") throw new Error("Markdown embed editor unavailable");

      editorView = embedCreator({
        app: plugin.app,
        linktext: null,
        sourcePath: context.sourcePath,
        containerEl: editorHost,
        displayMode: false,
        showInline: false,
        depth: 0,
      }, null);
      // 把私有 embed 纳入当前 MarkdownRenderChild 的生命周期，笔记关闭时可被统一卸载。
      component.addChild(editorView);
      editorView.editable = true;
      editorView.showEditor();
      if (!editorView.editor) throw new Error("Markdown editor was not initialized");
      editorView.editor.setValue(originalContent);
      editorDom = editorView.editor.cm?.dom ?? null;
      if (editorDom) editorDom.addEventListener("keydown", handleEditorKeydown);
      window.requestAnimationFrame(() => {
        if (editorView && editorView.editor) editorView.editor.focus();
      });
    } catch (error) {
      console.warn("Code Tab: native Markdown editor unavailable, using fallback", error);
      destroyEditor();
      createFallbackEditor();
    }

    // 指针离开整个内容面板时自动读取编辑器内容并保存。
    panel.addEventListener("mouseleave", save);
  };

  tabs.forEach((tab, index) => {
    const tabId = "code-tab-tab-" + groupSuffix + "-" + index;
    const panelId = "code-tab-panel-" + groupSuffix + "-" + index;

    const button = document.createElement("button");
    button.className = "code-tab__tab";
    button.type = "button";
    button.id = tabId;
    button.textContent = tab.title;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panelId);
    component.registerDomEvent(button, "click", () => activate(index));
    component.registerDomEvent(button, "keydown", (event) => {
      // 使用 WAI-ARIA tabs 常见键位，鼠标之外也能完整切换标签。
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();

      let next = activeIndex;
      if (event.key === "ArrowLeft") next = (activeIndex - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") next = (activeIndex + 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      activate(next, true);
    });
    tabList.appendChild(button);
    buttons.push(button);

    const panel = document.createElement("div");
    panel.className = "code-tab__panel markdown-rendered";
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabId);
    panel.hidden = true;
    panels.appendChild(panel);
    panelElements.push(panel);

    renderPanel(index);
    component.registerDomEvent(panel, "click", (event) => {
      if (editingIndex >= 0) return;
      // Obsidian 会给代码块附加复制/源码按钮。点击源码按钮时也进入编辑，
      // 但普通链接和表单控件仍保留它们原本的行为。
      const target = event.target as Element | null;
      if (!target) return;
      const codeButton = target.closest("pre button");
      if (codeButton) {
        event.preventDefault();
        event.stopPropagation();
      } else if (target.closest("a, button, input, textarea, select")) {
        return;
      }
      startEditing(index);
    });
  });

  activate(activeIndex);
}
