import type { Component } from "obsidian";
import type { TabView } from "./tabView";

export interface TabMoveTarget {
  view: TabView;
  after: boolean;
}

interface TabDragControllerOptions {
  views: TabView[];
  canStart: () => boolean;
  getLabel: (view: TabView) => string;
  onMove: (view: TabView, target: TabMoveTarget) => Promise<boolean>;
}

export interface TabDragController {
  attach(component: Component, view: TabView): void;
  clear(): void;
}

/**
 * 管理一个标签组内的 HTML5 拖拽瞬时状态。
 * 数据重排与 Markdown 保存仍由 tabGroup 负责，控制器只判断落点并发出移动请求。
 */
export function createTabDragController(options: TabDragControllerOptions): TabDragController {
  let draggedView: TabView | null = null;
  let dropTarget: TabMoveTarget | null = null;

  const clear = () => {
    for (const view of options.views) {
      view.button.classList.remove("is-dragging", "is-drop-before", "is-drop-after");
    }
    dropTarget = null;
  };

  const attach = (component: Component, view: TabView) => {
    const button = view.button;
    component.registerDomEvent(button, "dragstart", (event) => {
      if (!options.canStart()) {
        event.preventDefault();
        return;
      }
      draggedView = view;
      button.classList.add("is-dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", options.getLabel(view));
      }
    });
    component.registerDomEvent(button, "dragover", (event) => {
      if (!draggedView || !options.canStart()) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      clear();
      draggedView.button.classList.add("is-dragging");
      const bounds = button.getBoundingClientRect();
      const target: TabMoveTarget = {
        view,
        after: event.clientX >= bounds.left + bounds.width / 2,
      };
      dropTarget = target;
      button.classList.add(target.after ? "is-drop-after" : "is-drop-before");
    });
    component.registerDomEvent(button, "drop", (event) => {
      if (!draggedView || !dropTarget) {
        return;
      }
      event.preventDefault();
      const viewToMove = draggedView;
      const target = dropTarget;
      draggedView = null;
      clear();
      void options.onMove(viewToMove, target);
    });
    component.registerDomEvent(button, "dragend", () => {
      draggedView = null;
      clear();
    });
  };

  const controller: TabDragController = {
    attach,
    clear,
  };
  return controller;
}
