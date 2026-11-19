/** 可选的宿主渲染协议；宿主提供稳定组 id 和保存回调，普通 Markdown 路径不变。 */
import { Component, MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";
import type CodeTabPlugin from "./main";
import { renderTabGroup } from "./components/MultiTab";
import type { TabGroupHost } from "./components/MultiTab";

interface CodeBlockHostRequest {
  version: number;
  language: string;
  source: string;
  sourcePath: string;
  id: string;
  container: HTMLElement;
  component: Component;
  readOnly: boolean;
  onChange?: (expected: string, source: string | null) => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
  handled: boolean;
  completion?: Promise<void>;
}

export function registerCodeBlockHost(plugin: CodeTabPlugin): void {
  const attached = new WeakSet<Document>();
  const attach = (doc: Document): void => {
    if (attached.has(doc)) {
      return;
    }
    attached.add(doc);
    const lifecycle = plugin.addChild(new Component());
    const render = (event: Event): void => {
      const request = (event as CustomEvent<CodeBlockHostRequest>).detail;
      if (!request || request.version !== 1 || request.language !== "tab" || request.handled) {
        return;
      }
      request.handled = true;
      const component = request.component.addChild(new MarkdownRenderChild(request.container));
      const context: MarkdownPostProcessorContext = {
        docId: request.id,
        sourcePath: request.sourcePath,
        frontmatter: null,
        getSectionInfo: () => null,
        addChild: (child) => {
          component.addChild(child);
        },
      };
      const host: TabGroupHost = {
        id: request.id,
        readOnly: request.readOnly || !request.onChange,
        onChange: request.onChange,
        onEditingChange: request.onEditingChange,
      };
      request.completion = renderTabGroup(
        plugin,
        component,
        request.container,
        context,
        request.source,
        host,
      );
    };
    doc.addEventListener("obsidian-codeblock-render", render);
    lifecycle.register(() => doc.removeEventListener("obsidian-codeblock-render", render));
    const close = (): void => {
      plugin.removeChild(lifecycle);
    };
    doc.defaultView?.addEventListener("unload", close, {
      once: true,
    });
    lifecycle.register(() => doc.defaultView?.removeEventListener("unload", close));
  };
  attach(window.document);
  plugin.registerEvent(
    plugin.app.workspace.on("window-open", (_window, win) => attach(win.document)),
  );
}
