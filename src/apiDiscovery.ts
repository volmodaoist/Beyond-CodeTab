import { Component } from "obsidian";
import type CodeTabPlugin from "./main";
import type { CodeTabApi, CodeTabApiRequest } from "./openapi";

/** 所有窗口通过同一能力发现事件获得公开 API。 */
export function registerApiDiscovery(plugin: CodeTabPlugin, api: CodeTabApi): void {
  const attached = new WeakSet<Document>();
  const attach = (doc: Document): void => {
    if (attached.has(doc)) {
      return;
    }
    attached.add(doc);
    const lifecycle = plugin.addChild(new Component());
    const discover = (event: Event): void => {
      const request = (event as CustomEvent<CodeTabApiRequest>).detail;
      if (request && !request.api) {
        request.api = api;
      }
    };
    doc.addEventListener("obsidian-code-tab-api", discover);
    lifecycle.register(() => doc.removeEventListener("obsidian-code-tab-api", discover));
    const close = (): void => {
      plugin.removeChild(lifecycle);
    };
    const options: AddEventListenerOptions = {
      once: true,
    };
    doc.defaultView?.addEventListener("unload", close, options);
    lifecycle.register(() => doc.defaultView?.removeEventListener("unload", close));
  };
  attach(window.document);
  plugin.registerEvent(
    plugin.app.workspace.on("window-open", (_window, win) => attach(win.document)),
  );
}
