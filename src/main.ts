import { MarkdownRenderChild, Plugin } from "obsidian";
import type { Command } from "obsidian";
import { renderTabGroup } from "./components/MultiTab";

// 外层默认使用四个反引号，内部便可直接放常见的三个反引号代码块。
const TAB_FENCE = String.fromCharCode(96).repeat(4);
const TAB_TEMPLATE = [
  TAB_FENCE + "tab",
  "tab: 标签一",
  "内容一",
  "",
  "tab: 标签二",
  "内容二",
  TAB_FENCE,
].join("\n");

/**
 * Code Tab 的运行时分为两条路径：
 *
 * 1. 浏览时使用公开的 MarkdownRenderer，渲染轻、布局紧凑；
 * 2. 用户点击内容后，才临时创建 Obsidian 原生 Markdown embed editor。
 *
 * 这种设计保留了原生编辑体验，又避免像上游 2.0-alpha 那样为每个标签
 * 常驻一个完整编辑器，从而减少多余 DOM、事件监听器和整页式留白。
 */
export default class CodeTabPlugin extends Plugin {
  // key 为“文件路径 + tab 块起始行”，value 为当前选中的标签序号。
  // 状态仅存在于内存中，避免为了 UI 状态污染用户的 Markdown。
  activeTabs = new Map<string, number>();
  // key 同时包含 tab 块、标签序号和画板路径；value 始终使用稳定的 Frame ID。
  activeFrames = new Map<string, string>();

  async onload() {
    this.activeTabs.clear();
    this.activeFrames.clear();

    this.registerMarkdownCodeBlockProcessor("tab", (source, element, context) => {
      // 每个渲染出来的 tab 块都绑定一个生命周期组件。块离开页面时，
      // Obsidian 会卸载该组件，并清理通过组件注册的 DOM 事件。
      const component = new MarkdownRenderChild(element);
      context.addChild(component);
      renderTabGroup(this, component, element, context, source);
    });

    const createTabCommand: Command = {
      id: "create-tab",
      name: "创建标签组件",
      editorCallback: (editor) => {
        editor.replaceSelection(TAB_TEMPLATE);
      },
    };

    this.addCommand(createTabCommand);
  }

  onunload() {
    this.activeTabs.clear();
    this.activeFrames.clear();
  }
}
