import { Component } from "obsidian";
import type { MarkdownRenderChild } from "obsidian";
import type { CodeHighlighting } from "../CodeBlockEditor";

/** 一个标签对应一组 DOM 和资源。删除时一起释放，不用同步维护多个索引 Map。 */
export interface TabView {
  button: HTMLButtonElement;
  panel: HTMLDivElement;
  component: Component;
  preview: Component | null;
  highlighting: CodeHighlighting | null;
  rendering: boolean;
}

interface CreateTabViewOptions {
  owner: MarkdownRenderChild;
  tabList: HTMLDivElement;
  addButton: HTMLButtonElement;
  panels: HTMLDivElement;
  groupSuffix: string;
  index: number;
  title: string;
}

/** 创建一个标签的静态 DOM；交互事件由标签组和拖拽控制器分别注册。 */
export function createTabView(options: CreateTabViewOptions): TabView {
  const tabId = "code-tab-tab-" + options.groupSuffix + "-" + options.index;
  const panelId = "code-tab-panel-" + options.groupSuffix + "-" + options.index;

  const button = document.createElement("button");
  button.className = "code-tab__tab";
  button.setAttribute("data-testid", "code-tab-tab");
  button.type = "button";
  button.id = tabId;
  button.textContent = options.title;
  button.draggable = true;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", panelId);
  options.tabList.insertBefore(button, options.addButton);

  const panel = document.createElement("div");
  panel.className = "code-tab__panel markdown-rendered";
  panel.setAttribute("data-testid", "code-tab-panel");
  panel.id = panelId;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", tabId);
  panel.hidden = true;
  options.panels.appendChild(panel);

  const view: TabView = {
    button,
    panel,
    component: options.owner.addChild(new Component()),
    preview: null,
    highlighting: null,
    rendering: false,
  };

  return view;
}

/** 选择变化或标签重排后，集中刷新可见性、键盘焦点和 ARIA 关联。 */
export function syncTabViews(views: TabView[], activeIndex: number, groupSuffix: string): void {
  views.forEach((view, index) => {
    const active = index === activeIndex;
    view.button.id = "code-tab-tab-" + groupSuffix + "-" + index;
    view.panel.id = "code-tab-panel-" + groupSuffix + "-" + index;
    view.button.setAttribute("aria-controls", view.panel.id);
    view.panel.setAttribute("aria-labelledby", view.button.id);
    view.button.classList.toggle("is-active", active);
    view.button.setAttribute("aria-selected", String(active));
    view.button.setAttribute("tabindex", active ? "0" : "-1");
    view.panel.hidden = !active;
  });
}

/** 按 views 当前顺序重新挂载 DOM，不重建子组件或预览。 */
export function reorderTabViews(
  views: TabView[],
  tabList: HTMLDivElement,
  addButton: HTMLButtonElement,
  panels: HTMLDivElement,
): void {
  for (const view of views) {
    tabList.insertBefore(view.button, addButton);
    panels.appendChild(view.panel);
  }
}

export function removeTabView(owner: MarkdownRenderChild, view: TabView): void {
  owner.removeChild(view.component);
  view.button.remove();
  view.panel.remove();
}
