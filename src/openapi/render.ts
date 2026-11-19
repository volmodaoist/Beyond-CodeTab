import { MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type CodeTabPlugin from "../main";
import { renderTabGroup } from "../components/MultiTab";
import type { TabGroupController, TabGroupHost } from "../components/MultiTab";
import { CodeTabError, CodeTabErrorCode } from "./errors";
import { createCodeTabApi } from "./api";
import type { CodeTabApi, CodeTabHandle, CodeTabRenderOptions } from "./types";
import type { CompletionEngine } from "../core/completion";

class ApiRenderChild extends MarkdownRenderChild {
  active = false;
  release: (() => void) | null = null;

  onload(): void {
    this.active = true;
  }

  onunload(): void {
    this.active = false;
    this.release?.();
  }
}

interface MountedGroup {
  dispose(): void;
}

export interface CodeTabRuntime {
  api: CodeTabApi;
  renderMarkdown(
    source: string,
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): Promise<void>;
}

/** 宿主边界负责挂载和生命周期；公开 API 与 Markdown 共用同一标签组件。 */
export function createPluginApi(
  plugin: CodeTabPlugin,
  completion: CompletionEngine,
): CodeTabRuntime {
  const owners = new WeakMap<HTMLElement, MountedGroup>();
  const sessions = new Set<MountedGroup>();
  let disabled = false;
  let sequence = 0;
  plugin.register(() => {
    disabled = true;
    for (const session of [...sessions]) {
      session.dispose();
    }
  });

  const mount = async (
    options: CodeTabRenderOptions,
    markdownContext?: MarkdownPostProcessorContext,
  ): Promise<CodeTabHandle> => {
    if (disabled) {
      throw new CodeTabError(CodeTabErrorCode.Disposed, "Code Tab 已停用");
    }
    if (
      !options ||
      typeof options.source !== "string" ||
      typeof options.sourcePath !== "string" ||
      typeof options.id !== "string" ||
      !options.id.trim() ||
      !options.container?.ownerDocument ||
      options.container.nodeType !== 1 ||
      typeof options.component?.addChild !== "function" ||
      typeof options.component?.removeChild !== "function" ||
      (options.readOnly !== undefined && typeof options.readOnly !== "boolean") ||
      (options.onChange !== undefined && typeof options.onChange !== "function") ||
      (options.onEditingChange !== undefined && typeof options.onEditingChange !== "function")
    ) {
      throw new CodeTabError(CodeTabErrorCode.InvalidOptions, "无效的 Code Tab 挂载参数");
    }
    const previous = owners.get(options.container);
    if (previous) {
      if (markdownContext) {
        previous.dispose();
      } else {
        throw new CodeTabError(CodeTabErrorCode.ContainerInUse, "容器已有活动标签组");
      }
    }
    const component = new ApiRenderChild(options.container);
    let controller: TabGroupController | null = null;
    let closed = false;
    const session: MountedGroup = {
      dispose: () => {
        if (closed) {
          return;
        }
        const wasActive = component.active;
        closed = true;
        controller?.dispose();
        if (wasActive) {
          options.component.removeChild(component);
        }
        sessions.delete(session);
        if (owners.get(options.container) === session) {
          owners.delete(options.container);
          options.container.empty();
        }
      },
    };
    component.release = session.dispose;
    if (markdownContext) {
      markdownContext.addChild(component);
      component.load();
    } else {
      options.component.addChild(component);
      if (!component.active) {
        options.component.removeChild(component);
        throw new CodeTabError(CodeTabErrorCode.InvalidOptions, "父 Component 必须已经加载");
      }
    }
    owners.set(options.container, session);
    sessions.add(session);
    const hostedContext: MarkdownPostProcessorContext = {
      docId: options.id,
      sourcePath: options.sourcePath,
      frontmatter: null,
      getSectionInfo: () => null,
      addChild: (child) => {
        component.addChild(child);
      },
    };
    const context = markdownContext ?? hostedContext;
    const host: TabGroupHost = {
      id: "host:" + ++sequence + ":" + options.id,
      readOnly: options.readOnly || !options.onChange,
      onChange: options.onChange,
      onEditingChange: options.onEditingChange,
    };
    try {
      controller = renderTabGroup(
        plugin,
        component,
        options.container,
        context,
        options.source,
        markdownContext ? undefined : host,
      );
      await controller.ready;
      if (closed || disabled) {
        throw new CodeTabError(CodeTabErrorCode.Disposed, "初始化期间标签组已释放");
      }
      const handle: CodeTabHandle = {
        update: controller.update,
        getSnapshot: controller.getSnapshot,
        apply: controller.apply,
        selectTab: controller.selectTab,
        focus: controller.focus,
        startEditing: controller.startEditing,
        commit: controller.commit,
        cancel: controller.cancel,
        subscribe: controller.subscribe,
        dispose: session.dispose,
      };
      return Object.freeze(handle);
    } catch (error) {
      const wasClosed = closed || disabled;
      session.dispose();
      if (error instanceof CodeTabError) {
        throw error;
      }
      throw new CodeTabError(
        wasClosed ? CodeTabErrorCode.Disposed : CodeTabErrorCode.RenderFailed,
        "标签组初始化未完成",
        error,
      );
    }
  };
  const api = createCodeTabApi((options) => mount(options), completion);
  const runtime: CodeTabRuntime = {
    api,
    renderMarkdown: async (source, element, context) => {
      const options: CodeTabRenderOptions = {
        container: element,
        component: plugin,
        id: context.sourcePath || "markdown",
        source,
        sourcePath: context.sourcePath,
      };
      try {
        await mount(options, context);
      } catch (error) {
        // 阅读视图切换/关闭可在异步预览完成前卸载父组件；这是宿主取消，
        // 原生 Markdown 处理器正常收尾，公开 render 仍保留 Disposed 契约。
        if (error instanceof CodeTabError && error.code === CodeTabErrorCode.Disposed) {
          return;
        }
        throw error;
      }
    },
  };
  return runtime;
}
