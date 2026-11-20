import { setIcon } from "obsidian";
import type { Component } from "obsidian";

export interface TabToolbarOptions {
  owner: Component;
  header: HTMLElement;
  onCopy: () => Promise<void>;
  onReference?: () => Promise<void>;
  onEditSource?: () => Promise<void>;
}

export interface TabToolbar {
  element: HTMLDivElement;
  copy: HTMLButtonElement;
  reference: HTMLButtonElement | null;
  edit: HTMLButtonElement | null;
}

/** 标签栏右侧的固定操作区，不参与标签拖拽或横向滚动。 */
export function createTabToolbar(options: TabToolbarOptions): TabToolbar {
  const element = options.header.ownerDocument.createElement("div");
  element.className = "code-tab__tools";
  element.setAttribute("data-codeblock-interactive", "true");
  options.header.appendChild(element);
  options.owner.registerDomEvent(element, "mousedown", (event) => {
    // 工具按钮不抢走正文焦点，避免原生 CodeMirror 在 mouseup 前重建整个块。
    event.preventDefault();
    event.stopPropagation();
  });
  const button = (name: string, icon: string, testId: string): HTMLButtonElement => {
    const control = element.ownerDocument.createElement("button");
    control.className = "code-tab__tool";
    control.type = "button";
    control.title = name;
    control.setAttribute("aria-label", name);
    control.setAttribute("data-testid", testId);
    setIcon(control, icon);
    element.appendChild(control);
    return control;
  };
  const copy = button("复制当前标签完整内容", "copy", "code-tab-copy");
  options.owner.registerDomEvent(copy, "click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void options.onCopy();
  });
  let reference: HTMLButtonElement | null = null;
  if (options.onReference) {
    reference = button("复制当前标签引用", "link", "code-tab-reference");
    options.owner.registerDomEvent(reference, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void options.onReference?.();
    });
  }
  let edit: HTMLButtonElement | null = null;
  if (options.onEditSource) {
    edit = button("编辑整个标签组源码", "code-xml", "code-tab-edit");
    options.owner.registerDomEvent(edit, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void options.onEditSource?.();
    });
  }
  const toolbar: TabToolbar = {
    element,
    copy,
    reference,
    edit,
  };
  return toolbar;
}
