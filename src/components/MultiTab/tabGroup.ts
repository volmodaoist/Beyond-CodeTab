import { Component, Notice, setIcon } from "obsidian";
import type { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import type CodeTabPlugin from "../../main";
import type { TabData, TabGroupInfo } from "./types";
import {
  normalizeNewlines,
  parseTabs,
  safeId,
  serializeTabs,
  updateMarkdownSource,
} from "../../markdown";
import type { CodeHighlighting } from "../CodeBlockEditor";
import { renderTabPreview } from "./tabPreview";
import { TabEditor } from "./tabEditor";
import type { TabEditorOptions } from "./tabEditor";
import { attachTabActions } from "./tabActions";
import type { TabActionsOptions } from "./tabActions";

/** 一个标签对应一组 DOM 和资源。删除时一起释放，不用同步维护多个索引 Map。 */
interface TabView {
  button: HTMLButtonElement;
  panel: HTMLDivElement;
  component: Component;
  preview: Component | null;
  highlighting: CodeHighlighting | null;
  rendering: boolean;
}

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
  plugin: CodeTabPlugin,
  component: MarkdownRenderChild,
  element: HTMLElement,
  context: MarkdownPostProcessorContext,
  initialSource: string,
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

  const views: TabView[] = [];
  // 只在当前笔记打开期间记住选中的标签，不向 Markdown 写入额外状态。
  let activeIndex = Math.min(plugin.activeTabs.get(group.id) || 0, tabs.length - 1);
  let editingIndex = -1;
  let changingTabs = false;
  // 新增标签可先等待当前编辑保存；与鼠标移出共享同一次保存，避免并发覆盖。
  let saveCurrentEditor: (() => Promise<boolean>) | null = null;

  const activate = (index: number, focus = false, rememberSelection = true) => {
    // 编辑中不允许直接切换标签，否则鼠标点击会先销毁当前编辑器并丢失未保存内容。
    if (editingIndex >= 0 && editingIndex !== index) {
      return;
    }

    activeIndex = index;
    if (rememberSelection) {
      plugin.activeTabs.set(group.id, index);
    }

    views.forEach((view, buttonIndex) => {
      const button = view.button;
      const active = buttonIndex === index;
      // 删除后序号可能前移，ARIA 关联和键盘导航始终跟随当前顺序。
      button.id = "code-tab-tab-" + groupSuffix + "-" + buttonIndex;
      view.panel.id = "code-tab-panel-" + groupSuffix + "-" + buttonIndex;
      button.setAttribute("aria-controls", view.panel.id);
      view.panel.setAttribute("aria-labelledby", button.id);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("tabindex", active ? "0" : "-1");
      view.panel.hidden = !active;
    });

    if (focus) {
      views[index].button.focus();
    }
  };

  const renderPanel = async (index: number) => {
    const view = views[index];
    const panel = view.panel;
    view.rendering = true;
    view.highlighting = null;
    panel.empty();
    // 每次预览都有独立生命周期。切换到编辑或重新渲染时，旧嵌入的监听器与子组件一并释放。
    const previousPreview = view.preview;
    if (previousPreview) {
      view.component.removeChild(previousPreview);
    }
    const preview = view.component.addChild(new Component());
    view.preview = preview;
    try {
      const highlighting = await renderTabPreview(
        plugin.app,
        preview,
        panel,
        context.sourcePath,
        tabs[index].content,
      );
      if (highlighting) {
        view.highlighting = highlighting;
      }
    } finally {
      // 预览完成后才解锁高度，避免卸载编辑器到异步渲染完成之间先塌陷、再撑开。
      panel.classList.remove("is-editing", "is-restoring");
      panel.style.removeProperty("--code-tab-restore-height");
      view.rendering = false;
    }
  };

  const startEditing = (index: number, click: MouseEvent) => {
    // 一个标签组同时只编辑一个页面。编辑器负责输入，标签组统一负责写回和状态切换。
    if (editingIndex >= 0 || changingTabs || views[index].rendering) {
      return;
    }
    activate(index);
    editingIndex = index;
    element.addClass("is-editing");
    const view = views[index];
    const panel = view.panel;
    // 原生编辑器初始化会同步测量布局。先保留高度，防止清空长表格时整页短暂变短、
    // 浏览器把已有 scrollTop 裁到 0；初始化完成即释放，后续输入仍自然增高或收缩。
    panel.style.setProperty(
      "--code-tab-restore-height",
      panel.getBoundingClientRect().height + "px",
    );
    panel.addClass("is-restoring");
    const originalContent = tabs[index].content;
    const preview = view.preview;
    if (preview) {
      view.component.removeChild(preview);
    }
    view.preview = null;
    panel.empty();
    panel.addClass("is-editing");
    let saving = false;
    let pendingSave: Promise<boolean> | null = null;

    const leaveEditor = async () => {
      // 仅在切回异步预览期间保持当前高度，编辑过程中仍按内容自然增高或收缩。
      panel.style.setProperty(
        "--code-tab-restore-height",
        panel.getBoundingClientRect().height + "px",
      );
      panel.classList.add("is-restoring");
      view.component.removeChild(editor);
      try {
        if (panel.isConnected) {
          await renderPanel(index);
        }
      } finally {
        editingIndex = -1;
        saveCurrentEditor = null;
        element.removeClass("is-editing");
      }
    };

    const cancel = async () => {
      // 保存开始后不允许取消，避免两个异步操作同时释放会话；平时 Esc 不写文件。
      if (!saving) {
        await leaveEditor();
      }
    };

    const persistEdit = async (): Promise<boolean> => {
      if (editingIndex !== index || saving) {
        return false;
      }
      saving = true;
      try {
        const nextContent = editor.getValue().replace(/^\n+|\n+$/g, "");
        if (nextContent !== originalContent) {
          // 创建新数组，只有安全回写成功后才更新内存。失败时保留编辑器和原始匹配依据。
          const nextTabs = tabs.map((tab, tabIndex) => {
            const nextTab: TabData = {
              title: tab.title,
              content: tabIndex === index ? nextContent : tab.content,
            };
            return nextTab;
          });
          const nextSource = serializeTabs(nextTabs);
          await updateMarkdownSource(
            plugin.app,
            context.sourcePath,
            group.lineStart,
            source,
            nextSource,
          );
          tabs = nextTabs;
          source = nextSource;
        }
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
      // 鼠标移出、快捷键和新增按钮共享同一次保存，不重复写入文件。
      if (!pendingSave) {
        pendingSave = persistEdit().finally(() => {
          pendingSave = null;
        });
      }
      return pendingSave;
    };
    const options: TabEditorOptions = {
      app: plugin.app,
      panel,
      sourcePath: context.sourcePath,
      source: originalContent,
      highlighting: view.highlighting,
      click,
      addButton,
      onSave: save,
      onCancel: cancel,
    };
    const editor = view.component.addChild(new TabEditor(options));
    saveCurrentEditor = save;
  };

  /** title 为 null 表示删除；其余情况只替换标题，正文保持原样。 */
  const changeTab = async (index: number, title: string | null): Promise<boolean> => {
    if (changingTabs || index < 0) {
      return false;
    }
    changingTabs = true;
    addButton.disabled = true;
    const previousIndex = activeIndex;
    try {
      if (saveCurrentEditor && !(await saveCurrentEditor())) {
        return false;
      }
      const nextTabs = tabs.slice();
      if (title === null) {
        nextTabs.splice(index, 1);
      } else {
        const renamed: TabData = {
          title,
          content: tabs[index].content,
        };
        nextTabs[index] = renamed;
      }
      let nextIndex = activeIndex;
      if (title === null && index <= activeIndex) {
        if (index < activeIndex) {
          nextIndex = activeIndex - 1;
        } else {
          nextIndex = Math.min(index, nextTabs.length - 1);
        }
      }
      const nextSource = nextTabs.length ? serializeTabs(nextTabs) : null;
      // 先记住选择，以便宿主因文件变化重建组件后仍选中同一个剩余标签。
      if (nextIndex < 0) {
        plugin.activeTabs.delete(group.id);
      } else {
        plugin.activeTabs.set(group.id, nextIndex);
      }
      await updateMarkdownSource(
        plugin.app,
        context.sourcePath,
        group.lineStart,
        source,
        nextSource,
      );
      tabs = nextTabs;
      source = nextSource ?? "";
      if (title === null) {
        const removed = views.splice(index, 1)[0];
        component.removeChild(removed.component);
        removed.button.remove();
        removed.panel.remove();
      } else {
        views[index].button.textContent = title;
      }
      if (!tabs.length) {
        element.remove();
      } else if (element.isConnected) {
        // 标题失焦保存期间，用户可能已点了另一页；重命名不能把选择切回去。
        activate(title === null ? nextIndex : activeIndex);
      }
      return true;
    } catch (error) {
      plugin.activeTabs.set(group.id, previousIndex);
      console.error("Code Tab: failed to change tab", error);
      new Notice(error instanceof Error ? error.message : "标签修改失败", 5000);
      return false;
    } finally {
      changingTabs = false;
      addButton.disabled = false;
    }
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
    const tabComponent = component.addChild(new Component());
    tabComponent.registerDomEvent(button, "click", () => activate(views.indexOf(view)));
    tabComponent.registerDomEvent(button, "keydown", (event) => {
      // 使用 WAI-ARIA tabs 常见键位，鼠标之外也能完整切换标签。
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();

      let next = activeIndex;
      if (event.key === "ArrowLeft") {
        next = (activeIndex - 1 + tabs.length) % tabs.length;
      }
      if (event.key === "ArrowRight") {
        next = (activeIndex + 1) % tabs.length;
      }
      if (event.key === "Home") {
        next = 0;
      }
      if (event.key === "End") {
        next = tabs.length - 1;
      }
      activate(next, true);
    });
    tabList.insertBefore(button, addButton);

    const panel = document.createElement("div");
    panel.className = "code-tab__panel markdown-rendered";
    panel.setAttribute("data-testid", "code-tab-panel");
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabId);
    panel.hidden = true;
    panels.appendChild(panel);
    const view: TabView = {
      button,
      panel,
      component: tabComponent,
      preview: null,
      highlighting: null,
      rendering: false,
    };
    views.push(view);
    const actions: TabActionsOptions = {
      app: plugin.app,
      component: tabComponent,
      button,
      canStart: () => !changingTabs && editingIndex < 0,
      isLastTab: () => tabs.length === 1,
      onRename: (title) => changeTab(views.indexOf(view), title),
      onDelete: () => changeTab(views.indexOf(view), null),
    };
    attachTabActions(actions);
    renderPanel(index);
    tabComponent.registerDomEvent(panel, "click", (event) => {
      if (editingIndex >= 0) {
        return;
      }
      // Obsidian 会给代码块附加复制/源码按钮。点击源码按钮时也进入编辑，
      // 但普通链接和表单控件仍保留它们原本的行为。
      const target = event.target as Element | null;
      if (!target) {
        return;
      }
      // 图片、笔记和 Excalidraw 等嵌入保留自己的点击/双击行为，不把画布替换成链接源码。
      // Excalidraw 渲染完成后会替换宿主的 internal-embed 外壳，需要识别它自己的预览节点。
      if (target.closest(".internal-embed, .excalidraw-svg, .excalidraw-embedded-img")) {
        return;
      }
      const codeButton = target.closest("pre button");
      if (codeButton) {
        event.preventDefault();
        event.stopPropagation();
      } else if (target.closest("a, button, input, textarea, select")) {
        return;
      }
      startEditing(views.indexOf(view), event);
    });
  };

  component.registerDomEvent(addButton, "click", async () => {
    if (changingTabs) {
      return;
    }
    changingTabs = true;
    addButton.disabled = true;
    const previousIndex = activeIndex;
    try {
      if (saveCurrentEditor && !(await saveCurrentEditor())) {
        return;
      }
      // 默认标题避开已有同名标签；空代码块可立即输入，并通过语言框选择着色方式。
      let number = tabs.length + 1;
      while (tabs.some((tab) => tab.title === "标签" + number)) {
        number += 1;
      }
      const tab: TabData = {
        title: "标签" + number,
        content: EMPTY_CODE_BLOCK,
      };
      const index = tabs.length;
      // 只在原 source 后追加，保留原标签的格式；仍使用带旧内容检查的安全回写。
      const nextSource = source + "\n\n" + serializeTabs([tab]);
      // 宿主可能因文件更新重建组件，先记录选择，让重建后的组件也显示新标签。
      plugin.activeTabs.set(group.id, index);
      await updateMarkdownSource(
        plugin.app,
        context.sourcePath,
        group.lineStart,
        source,
        nextSource,
      );
      tabs.push(tab);
      source = nextSource;
      if (element.isConnected) {
        createTabElements(tab, index);
        activate(index, true);
        const scrollOptions: ScrollIntoViewOptions = {
          block: "nearest",
          inline: "nearest",
        };
        views[index].button.scrollIntoView(scrollOptions);
      }
    } catch (error) {
      plugin.activeTabs.set(group.id, previousIndex);
      console.error("Code Tab: failed to add tab", error);
      new Notice(error instanceof Error ? error.message : "新增标签失败", 5000);
    } finally {
      changingTabs = false;
      addButton.disabled = false;
    }
  });

  tabs.forEach(createTabElements);

  // 初始化只显示当前可用的标签，不覆盖已经记录的选择。保存后紧接新增时，
  // 宿主可能先用旧的标签数量重建一次；不能用这次临时的截断索引覆盖新标签索引。
  activate(activeIndex, false, false);
}
