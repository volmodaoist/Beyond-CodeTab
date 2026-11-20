import { MarkdownView, Notice } from "obsidian";
import type { EditorPosition, EditorRange, OpenViewState } from "obsidian";
import type CodeTabPlugin from "./main";
import { findReferencedTab } from "./components/MultiTab";

/** 专用协议只追加标签选择；文件和原生块定位仍由 Obsidian 完成。 */
export function registerTabReferenceNavigation(plugin: CodeTabPlugin): void {
  let active = true;
  plugin.register(() => {
    active = false;
  });
  plugin.registerObsidianProtocolHandler("beyond-code-tab", async (params) => {
    try {
      if (!active) {
        return;
      }
      if (!params.block || !params.tab) {
        throw new Error("标签引用链接不完整");
      }
      const target = await findReferencedTab(plugin.app, params.block, params.tab);
      if (!active) {
        return;
      }
      if (!target) {
        throw new Error("引用的标签已不存在");
      }
      const file = target.file;
      const tabId = params.block + "-" + params.tab;
      const key = file.path + ":" + target.line;
      const controllers = [...plugin.referenceTargets.entries()]
        .filter(([groupKey]) => groupKey.startsWith(file.path + ":"))
        .flatMap(([, targets]) => [...targets])
        .filter((controller) => controller.getSnapshot().tabs.some((tab) => tab.id === tabId));
      // 同组正在编辑时保留草稿，避免跳转强行切换标签。
      if (controllers.some((controller) => controller.getSnapshot().editing)) {
        throw new Error("请先保存或取消当前标签编辑，再打开引用");
      }
      plugin.activeTabs.set(key, target.index);
      const current = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const leaf =
        current?.file?.path === file.path
          ? current.leaf
          : (plugin.app.workspace
              .getLeavesOfType("markdown")
              .find(
                (candidate) =>
                  candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path,
              ) ?? plugin.app.workspace.getLeaf(false));
      const rawSource = leaf.view instanceof MarkdownView && leaf.view.getState().source === true;
      // 实时预览的光标落在围栏内会展开整块源码；放在组锚点行即可保留标签组件。
      const position: EditorPosition = {
        line: rawSource ? target.line : target.anchorLine,
        ch: 0,
      };
      const cursor: EditorRange = {
        from: position,
        to: position,
      };
      const eState: Record<string, unknown> = {
        cursor,
        scroll: target.line,
      };
      const viewState: OpenViewState = {
        active: true,
        eState,
      };
      await leaf.openFile(file, viewState);
      if (!active) {
        return;
      }
      for (const [groupKey, targets] of plugin.referenceTargets) {
        if (!groupKey.startsWith(file.path + ":")) {
          continue;
        }
        for (const controller of targets) {
          await controller.ready;
          if (!active) {
            return;
          }
          const index = controller.getSnapshot().tabs.findIndex((tab) => tab.id === tabId);
          if (index >= 0) {
            plugin.activeTabs.set(groupKey, index);
            controller.selectTab(index);
          }
        }
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "无法打开标签引用");
    }
  });
}
