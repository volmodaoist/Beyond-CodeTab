import { Component, loadPrism, MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import { Compartment, EditorSelection, StateEffect } from "@codemirror/state";
import type { Extension, TransactionSpec } from "@codemirror/state";
import type * as Prism from "prismjs";
import type CodeTabPlugin from "../main";
import type {
  AppWithEmbedRegistry, MarkdownEmbedContext, MarkdownEmbedOptions,
  NativeMarkdownEmbed, TabData, TabGroupInfo,
} from "./types";
import {
  normalizeNewlines, normalizePreviewFenceLanguages, parseTabs, safeId,
  serializeTabs, updateMarkdownSource,
} from "../markdown";
import { codeBlockEditorExtensions, findCodeBlockBody } from "./codeBlockEditor";
import { codeHighlighting } from "./codeHighlighting";
import type { CodeHighlighting } from "./codeHighlighting";
import { getCodeLanguage, replaceCodeLanguage } from "./codeLanguage";
import { CodeLanguageInput } from "./languageInput";

const EMPTY_CODE_BLOCK = "```text\n\n```";

function getGroupInfo(context: MarkdownPostProcessorContext, element: HTMLElement): TabGroupInfo {
  const section = context.getSectionInfo(element);
  // 行号既用于区分同一文件中的多个 tab 块，也用于保存时选择最接近的匹配项。
  const group: TabGroupInfo = {
    id: context.sourcePath + ":" + (section ? section.lineStart : 0),
    lineStart: section ? section.lineStart : 0,
  };

  return group;
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
  // 测试标识描述组件用途；同页多个标签组由父容器限定范围，不占用全局 DOM id。
  element.setAttribute("data-testid", "code-tab-group");

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
  tabList.setAttribute("data-testid", "code-tab-list");
  tabList.setAttribute("role", "tablist");
  element.appendChild(tabList);

  const addButton = document.createElement("button");
  addButton.className = "code-tab__add";
  addButton.type = "button";
  addButton.setAttribute("data-testid", "code-tab-add");
  // SVG 图标使用与标签相同的居中布局，避免文本 + 的字体基线造成视觉下沉。
  setIcon(addButton, "plus");
  addButton.setAttribute("aria-label", "新增标签");
  addButton.title = "新增标签";
  tabList.appendChild(addButton);

  const panels = document.createElement("div");
  panels.className = "code-tab__panels";
  element.appendChild(panels);

  const buttons: HTMLButtonElement[] = [];
  const panelElements: HTMLDivElement[] = [];
  const renderingPanels = new Set<number>();
  const panelHighlighting = new Map<number, CodeHighlighting>();
  // 只在当前笔记打开期间记住选中的标签，不向 Markdown 写入额外状态。
  let activeIndex = Math.min(plugin.activeTabs.get(group.id) || 0, tabs.length - 1);
  let editingIndex = -1;
  let addingTab = false;
  // 新增标签可先等待当前编辑保存；与鼠标移出共享同一次保存，避免并发覆盖。
  let saveCurrentEditor: (() => Promise<boolean>) | null = null;

  const activate = (index: number, focus = false, rememberSelection = true) => {
    // 编辑中不允许直接切换标签，否则鼠标点击会先销毁当前编辑器并丢失未保存内容。
    if (editingIndex >= 0 && editingIndex !== index) return;

    activeIndex = index;
    if (rememberSelection) plugin.activeTabs.set(group.id, index);

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
    renderingPanels.add(index);
    panelHighlighting.delete(index);
    panel.empty();
    // 浏览态始终走公开 API；它比完整 embed editor 更轻，也天然支持链接、列表和代码块。
    // 部分语言名在编辑器里能识别，但 MarkdownRenderer 只接受 Prism 的规范别名。
    // 这里只转换交给预览器的副本，用户源文件中的 c++、c# 等写法保持不变。
    const previewSource = normalizePreviewFenceLanguages(tabs[index].content);
    try {
      await MarkdownRenderer.render(plugin.app, previewSource, panel, context.sourcePath, component);
      if (findCodeBlockBody(tabs[index].content)) {
        // 预览完成后读取规范语言名（例如 c++ 已转换为 cpp），共用宿主已加载的语法定义。
        // 提前准备扩展，点击时无需等异步加载，也不会先闪出一帧 CodeMirror 的颜色。
        const code = panel.querySelector("pre code");
        const languageClass = code && Array.from(code.classList).find((name) => name.startsWith("language-"));
        const language = languageClass ? languageClass.slice("language-".length) : "";
        const prism: typeof Prism = await loadPrism();
        panelHighlighting.set(index, codeHighlighting(prism, language));
      }
    } finally {
      // 预览完成后才解锁高度，避免卸载编辑器到异步渲染完成之间先塌陷、再撑开。
      panel.classList.remove("is-editing", "is-restoring");
      panel.style.removeProperty("--code-tab-restore-height");
      renderingPanels.delete(index);
    }
  };

  const startEditing = (index: number, click: MouseEvent) => {
    // 一个 tab 组件同一时间只维护一个编辑会话。
    if (editingIndex >= 0 || addingTab || renderingPanels.has(index)) return;
    activate(index);
    editingIndex = index;
    element.addClass("is-editing");

    const panel = panelElements[index];
    const originalContent = tabs[index].content;
    const codeBody = findCodeBlockBody(originalContent);
    let highlighting = panelHighlighting.get(index);
    const highlightingSlot = new Compartment();
    let languageInput: CodeLanguageInput | null = null;
    let saving = false;
    let pendingSave: Promise<boolean> | null = null;
    let editorView: NativeMarkdownEmbed | null = null;
    let fallbackTextarea: HTMLTextAreaElement | null = null;
    let pointerX = click.clientX;
    let pointerY = click.clientY;
    // 临时会话统一管理原生编辑器和文档级事件，退出、关笔记或禁用插件时一并释放。
    const editorSession = component.addChild(new Component());
    // 原生编辑器的整页留白由局部 CSS 清理；正文和外围容器均按内容自然排版。
    // 进入编辑时字体/留白不变，新增或删除行时则允许卡片跟着增高或收缩。
    panel.empty();
    panel.addClass("is-editing");

    const editorHost = document.createElement("div");
    editorHost.className = "code-tab__native-editor";
    editorHost.setAttribute("data-testid", "code-tab-editor");
    editorHost.classList.toggle("has-prism-highlighting", !!highlighting);
    // Prism 样式也会按语言区分 token，例如 CSS 字符串的颜色不同于普通字符串。
    if (highlighting?.language) editorHost.classList.add("language-" + highlighting.language);
    panel.appendChild(editorHost);

    const getEditorValue = () => {
      // 原生编辑器和降级 textarea 对保存层暴露相同的字符串接口。
      if (editorView && editorView.editor) return editorView.editor.getValue();
      if (!fallbackTextarea) return originalContent;
      if (!codeBody) return fallbackTextarea.value;
      // 降级输入框只编辑正文，保存时拼回未经修改的围栏与语言名。
      return originalContent.slice(0, codeBody.from) + fallbackTextarea.value +
        originalContent.slice(codeBody.to);
    };

    const destroyEditor = () => {
      if (!editorView) return;
      try {
        // 动态创建的子组件必须及时卸载，避免关闭标签后仍保留编辑器监听器。
        editorSession.removeChild(editorView);
      } catch (error) {
        console.warn("Code Tab: failed to unload native Markdown editor", error);
      }
      editorView = null;
    };

    const leaveEditor = async () => {
      // 仅在切回异步预览时暂存当前高度；编辑过程中不限制正文高度。
      panel.style.setProperty("--code-tab-restore-height", panel.getBoundingClientRect().height + "px");
      panel.classList.add("is-restoring");
      // 先解绑手工注册的事件，再卸载原生组件，最后恢复轻量预览。
      if (fallbackTextarea) {
        fallbackTextarea.removeEventListener("input", resizeFallbackEditor);
      }
      destroyEditor();
      component.removeChild(editorSession);
      try {
        if (panel.isConnected) await renderPanel(index);
      } finally {
        editingIndex = -1;
        saveCurrentEditor = null;
        element.removeClass("is-editing");
      }
    };

    const cancel = async () => {
      // Esc 只退出本次会话，不触碰文件，也不改变内存中的标签内容。
      // 保存已开始时等待写入完成，避免取消和保存同时恢复预览、释放布局。
      if (saving) return;
      tabs[index].content = originalContent;
      await leaveEditor();
    };

    const persistEdit = async (): Promise<boolean> => {
      if (editingIndex !== index || saving) return false;
      if (languageInput?.value === null) {
        new Notice("语言名只能包含字母、数字、+、#、-、_ 和 .", 5000);
        languageInput.input.focus();
        return false;
      }
      saving = true;

      try {
        let nextContent = getEditorValue().replace(/^\n+|\n+$/g, "");
        // 编辑器继续保护原始围栏，语言选择在保存时合入，不重建编辑器或打断正文撤销历史。
        if (languageInput && languageInput.input.value !== getCodeLanguage(originalContent)) {
          const language = languageInput.value;
          if (language !== null) nextContent = replaceCodeLanguage(nextContent, language);
        }
        // 鼠标移出同样会触发保存；内容未变化时直接退出，避免无意义地改写文件。
        if (nextContent === originalContent) {
          await leaveEditor();
          return true;
        }

        const nextTabs = tabs.map((tab, tabIndex) => {
          // 创建新数组而不是原地修改；只有文件写入成功后才提交到内存状态。
          const nextTab: TabData = {
            title: tab.title,
            content: tabIndex === index ? nextContent : tab.content,
          };

          return nextTab;
        });
        const nextSource = serializeTabs(nextTabs);

        // 先安全写回源文件，再更新预览使用的 source/tabs，避免失败时 UI 假装已保存。
        await updateMarkdownSource(plugin.app, context.sourcePath, group.lineStart, source, nextSource);
        tabs = nextTabs;
        source = nextSource;
        await leaveEditor();
        return true;
      } catch (error) {
        console.error("Code Tab: failed to save tab content", error);
        new Notice(error instanceof Error ? error.message : "标签内容保存失败", 5000);
        saving = false;
        return false;
      }
    };

    const save = (): Promise<boolean> => {
      if (!pendingSave) pendingSave = persistEdit().finally(() => { pendingSave = null; });
      return pendingSave;
    };
    saveCurrentEditor = save;

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
        event.stopPropagation();
        save();
      }
    }

    function handleSessionKeydown(event: KeyboardEvent) {
      // 窗口捕获监听只处理本面板，覆盖正文、语言框和降级输入框，不影响其他笔记。
      if (event.composedPath().includes(panel)) handleEditorKeydown(event);
    }

    function handlePointerMove(event: MouseEvent) {
      // 内容增高、收缩或页面跟随光标滚动都会触发 mouseleave，即使鼠标没有移动。
      // 只在指针实际移动到面板外时保存，避免用户正在回车/删除时突然退出编辑。
      const moved = event.clientX !== pointerX || event.clientY !== pointerY;
      pointerX = event.clientX;
      pointerY = event.clientY;
      // 移向 + 时交给新增动作保存，让保存和新增按顺序完成。
      const path = event.composedPath();
      if (moved && !path.includes(panel) && !path.includes(addButton)) save();
    }

    function resizeFallbackEditor() {
      if (!fallbackTextarea) return;
      // textarea 不会像 CodeMirror 一样随正文排版。先归零再测量，增行和删行都能生效。
      // 两次赋值在同一个输入事件内完成，不会把中间的零高度绘制到界面上。
      fallbackTextarea.style.height = "0";
      fallbackTextarea.style.height = fallbackTextarea.scrollHeight + "px";
    }

    const createFallbackEditor = () => {
      // 私有 embed API 在未来版本失效时，至少保留一个始终可见、可保存的编辑入口。
      editorHost.empty();
      fallbackTextarea = document.createElement("textarea");
      fallbackTextarea.className = "code-tab__fallback-editor";
      fallbackTextarea.setAttribute("data-testid", "code-tab-fallback");
      fallbackTextarea.value = codeBody
        ? originalContent.slice(codeBody.from, codeBody.to)
        : originalContent;
      fallbackTextarea.spellcheck = false;
      fallbackTextarea.rows = 1;
      fallbackTextarea.addEventListener("input", resizeFallbackEditor);
      editorHost.appendChild(fallbackTextarea);
      resizeFallbackEditor();
      window.requestAnimationFrame(() => fallbackTextarea?.focus());
    };

    try {
      // 仅在用户点击时懒加载原生 Markdown 编辑器；离开后立即销毁，避免旧版常驻 embed 的臃肿布局。
      const embedRegistry = (plugin.app as AppWithEmbedRegistry).embedRegistry ||
        (window as Window & { app?: AppWithEmbedRegistry }).app?.embedRegistry;
      const embedOptions: MarkdownEmbedOptions = {
        extension: "md",
      };
      const embedCreator = embedRegistry && embedRegistry.getEmbedCreator(embedOptions);
      if (typeof embedCreator !== "function") throw new Error("Markdown embed editor unavailable");

      const embedContext: MarkdownEmbedContext = {
        app: plugin.app,
        linktext: null,
        sourcePath: context.sourcePath,
        containerEl: editorHost,
        displayMode: false,
        showInline: false,
        depth: 0,
      };

      editorView = embedCreator(embedContext, null);
      // 私有 embed 归属临时会话，最终仍由 MarkdownRenderChild 管理生命周期。
      editorSession.addChild(editorView);
      editorView.editable = true;
      editorView.showEditor();
      if (!editorView.editor) throw new Error("Markdown editor was not initialized");
      editorView.editor.setValue(originalContent);
      const codeMirror = editorView.editor.cm;
      if (codeBody && codeMirror) {
        // 纯代码标签保留原生编辑功能；围栏折叠，正文着色则与预览共用 Prism。
        const extensions: Extension[] = codeBlockEditorExtensions();
        // 独立 compartment 只更换着色，语言切换不影响围栏保护、光标和正文撤销。
        extensions.push(highlightingSlot.of(highlighting ? highlighting.extension : []));
        const transaction: TransactionSpec = {
          effects: StateEffect.appendConfig.of(extensions),
          selection: EditorSelection.single(codeBody.from),
        };
        codeMirror.dispatch(transaction);
      }
      window.requestAnimationFrame(() => {
        if (editorView && editorView.editor) editorView.editor.focus();
      });
    } catch (error) {
      console.warn("Code Tab: native Markdown editor unavailable, using fallback", error);
      destroyEditor();
      createFallbackEditor();
    }

    if (codeBody) {
      languageInput = editorSession.addChild(new CodeLanguageInput(
        panel, getCodeLanguage(originalContent) || "", plugin.app, context.sourcePath,
        (nextHighlighting) => {
          if (highlighting?.language) editorHost.classList.remove("language-" + highlighting.language);
          highlighting = nextHighlighting;
          editorHost.classList.add("has-prism-highlighting", "language-" + highlighting.language);
          const transaction: TransactionSpec = {
            effects: highlightingSlot.reconfigure(highlighting.extension),
          };
          editorView?.editor?.cm?.dispatch(transaction);
        }
      ));
      editorSession.registerDomEvent(languageInput.input, "keydown", (event) => {
        // 普通 Enter 确认语言并回到正文；保存/取消快捷键沿用整个编辑会话的规则。
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          event.stopPropagation();
          if (languageInput?.value !== null) {
            if (editorView?.editor) editorView.editor.focus();
            else fallbackTextarea?.focus();
          }
        }
      });
    }

    // 宿主全局 keymap 在窗口捕获阶段拦截 Cmd/Ctrl+Enter，事件不会到达输入框。
    // 在同一阶段处理快捷键；会话卸载时清理，关闭笔记和禁用插件也不会留下窗口监听。
    const editorWindow = panel.ownerDocument.defaultView;
    editorWindow?.addEventListener("keydown", handleSessionKeydown, true);
    editorSession.register(() => editorWindow?.removeEventListener("keydown", handleSessionKeydown, true));

    // 在文档上观察真实移动，面板因布局变化移走后，下一次主动移出仍可触发保存。
    editorSession.registerDomEvent(panel.ownerDocument, "mousemove", handlePointerMove);
  };

  const createTabElements = (tab: TabData, index: number) => {
    const tabId = "code-tab-tab-" + groupSuffix + "-" + index;
    const panelId = "code-tab-panel-" + groupSuffix + "-" + index;

    const button = document.createElement("button");
    button.className = "code-tab__tab";
    button.setAttribute("data-testid", "code-tab-tab");
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
    tabList.insertBefore(button, addButton);
    buttons.push(button);

    const panel = document.createElement("div");
    panel.className = "code-tab__panel markdown-rendered";
    panel.setAttribute("data-testid", "code-tab-panel");
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
      startEditing(index, event);
    });
  };

  component.registerDomEvent(addButton, "click", async () => {
    if (addingTab) return;
    addingTab = true;
    addButton.disabled = true;
    const previousIndex = activeIndex;
    try {
      if (saveCurrentEditor && !await saveCurrentEditor()) return;
      // 默认标题避开已有同名标签；空代码块可立即输入，并通过语言框选择着色方式。
      let number = tabs.length + 1;
      while (tabs.some((tab) => tab.title === "标签" + number)) number += 1;
      const tab: TabData = {
        title: "标签" + number,
        content: EMPTY_CODE_BLOCK,
      };
      const index = tabs.length;
      // 只在原 source 后追加，保留原标签的格式；仍使用带旧内容检查的安全回写。
      const nextSource = source + "\n\n" + serializeTabs([tab]);
      // 宿主可能因文件更新重建组件，先记录选择，让重建后的组件也显示新标签。
      plugin.activeTabs.set(group.id, index);
      await updateMarkdownSource(plugin.app, context.sourcePath, group.lineStart, source, nextSource);
      tabs.push(tab);
      source = nextSource;
      if (element.isConnected) {
        createTabElements(tab, index);
        activate(index, true);
        const scrollOptions: ScrollIntoViewOptions = {
          block: "nearest",
          inline: "nearest",
        };
        buttons[index].scrollIntoView(scrollOptions);
      }
    } catch (error) {
      plugin.activeTabs.set(group.id, previousIndex);
      console.error("Code Tab: failed to add tab", error);
      new Notice(error instanceof Error ? error.message : "新增标签失败", 5000);
    } finally {
      addingTab = false;
      addButton.disabled = false;
    }
  });

  tabs.forEach(createTabElements);

  // 初始化只显示当前可用的标签，不覆盖已经记录的选择。保存后紧接新增时，
  // 宿主可能先用旧的标签数量重建一次；不能用这次临时的截断索引覆盖新标签索引。
  activate(activeIndex, false, false);
}
