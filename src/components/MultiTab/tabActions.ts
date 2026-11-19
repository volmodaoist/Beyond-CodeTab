import { Component, Menu, Modal, Notice } from "obsidian";
import type { App } from "obsidian";

export interface TabActionsOptions {
  app: App;
  component: Component;
  button: HTMLButtonElement;
  canStart: () => boolean;
  isLastTab: () => boolean;
  onRename: (title: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  onInteractionChange?: (active: boolean) => void;
}

/** 只管理标题输入和确认界面；文件写入由标签组处理，失败时保留当前界面。 */
export function attachTabActions(options: TabActionsOptions): void {
  const { component, button } = options;
  let renameSession: Component | null = null;
  let menu: Menu | null = null;
  let dialog: DeleteTabModal | null = null;
  const hasTitleInput = () => !!button.parentElement?.querySelector(".code-tab__rename-input");

  component.register(() => {
    menu?.hide();
    dialog?.dispose();
  });

  component.registerDomEvent(button, "contextmenu", (event) => {
    if (!options.canStart()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    menu?.hide();
    menu = new Menu();
    // 使用 Obsidian 的 DOM 菜单，菜单外观跟随当前仓库主题。
    menu.setUseNativeMenu(false);
    menu.addItem((item) => {
      item.setTitle("删除标签");
      item.setIcon("trash-2");
      item.setWarning(true);
      item.setDisabled(!options.canStart() || hasTitleInput());
      item.onClick(() => {
        dialog = new DeleteTabModal(
          options.app,
          button.textContent || "",
          options.isLastTab(),
          options.onDelete,
          options.onInteractionChange,
        );
        dialog.open();
      });
    });
    menu.showAtMouseEvent(event);
  });

  component.registerDomEvent(button, "dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (renameSession || hasTitleInput() || !options.canStart()) {
      return;
    }
    let alive = true;
    const session = component.addChild(new Component());
    renameSession = session;
    options.onInteractionChange?.(true);
    const input = button.ownerDocument.createElement("input");
    input.type = "text";
    input.className = "code-tab__rename-input";
    input.setAttribute("data-testid", "code-tab-rename");
    input.setAttribute("aria-label", "标签名称");
    input.value = button.textContent || "";
    input.style.width = Math.max(100, button.getBoundingClientRect().width) + "px";
    // 用 input 暂时替换 button，避免把一个可交互控件嵌套在另一个控件中。
    button.replaceWith(input);
    session.register(() => {
      alive = false;
      input.replaceWith(button);
      renameSession = null;
      options.onInteractionChange?.(false);
    });

    let finished = false;
    let saving = false;
    const finish = (focus: boolean) => {
      finished = true;
      component.removeChild(session);
      if (focus && button.isConnected) {
        button.focus();
      }
    };
    const save = async (focus: boolean) => {
      if (finished || saving) {
        return;
      }
      const title = input.value.trim();
      if (!title) {
        input.setAttribute("aria-invalid", "true");
        new Notice("标签名称不能为空");
        input.focus();
        return;
      }
      if (title === button.textContent) {
        finish(focus);
        return;
      }
      saving = true;
      input.readOnly = true;
      if (await options.onRename(title)) {
        if (!alive || finished) {
          return;
        }
        finish(focus);
      } else {
        if (!alive || finished) {
          return;
        }
        // 乐观回写冲突时保留用户输入，允许重试或 Esc 退出。
        saving = false;
        input.readOnly = false;
        input.focus();
      }
    };
    session.registerDomEvent(input, "keydown", (key) => {
      key.stopPropagation();
      if (key.isComposing || saving) {
        return;
      }
      if (key.key === "Enter") {
        key.preventDefault();
        void save(true);
      } else if (key.key === "Escape") {
        key.preventDefault();
        finish(true);
      }
    });
    session.registerDomEvent(input, "blur", () => {
      void save(false);
    });
    session.registerDomEvent(input, "input", () => {
      input.removeAttribute("aria-invalid");
    });
    input.focus();
    input.select();
  });
}

/** 使用宿主 Modal，默认焦点放在取消按钮；确认成功后才关闭。 */
class DeleteTabModal extends Modal {
  private saving = false;
  private disposed = false;
  private interactionActive = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly lastTab: boolean,
    private readonly onConfirm: () => Promise<boolean>,
    private readonly onInteractionChange?: (active: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.interactionActive = true;
    this.onInteractionChange?.(true);
    this.setTitle("删除标签");
    this.containerEl.setAttribute("data-testid", "code-tab-delete-dialog");
    const description = this.contentEl.ownerDocument.createElement("p");
    description.textContent = `确认删除“${this.title}”及其全部内容？`;
    if (this.lastTab) {
      description.textContent += "这是最后一个标签，删除后整个标签组件也会移除。";
    }
    this.contentEl.appendChild(description);
    const buttons = this.contentEl.ownerDocument.createElement("div");
    buttons.className = "code-tab__dialog-actions";
    this.contentEl.appendChild(buttons);
    const cancel = buttons.ownerDocument.createElement("button");
    cancel.textContent = "取消";
    cancel.setAttribute("data-testid", "code-tab-delete-cancel");
    cancel.onclick = () => this.close();
    buttons.appendChild(cancel);
    const confirm = buttons.ownerDocument.createElement("button");
    confirm.textContent = "删除";
    confirm.className = "mod-warning";
    confirm.setAttribute("data-testid", "code-tab-delete-confirm");
    confirm.onclick = async () => {
      if (this.saving) {
        return;
      }
      this.saving = true;
      confirm.disabled = true;
      cancel.disabled = true;
      const deleted = await this.onConfirm();
      if (this.disposed) {
        return;
      }
      this.saving = false;
      if (deleted) {
        this.close();
      } else {
        confirm.disabled = false;
        cancel.disabled = false;
      }
    };
    buttons.appendChild(confirm);
    cancel.focus();
  }

  close(): void {
    // 确认后写入已开始，不能再把关闭弹窗误当作取消写入。
    if (!this.saving) {
      super.close();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.saving = false;
    super.close();
  }

  onClose(): void {
    if (this.interactionActive) {
      this.interactionActive = false;
      this.onInteractionChange?.(false);
    }
    this.contentEl.empty();
  }
}
