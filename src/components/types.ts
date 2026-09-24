import type { App, Component, Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";

export interface TabData {
  title: string;
  content: string;
}

export interface TabBlock {
  start: number;
  end: number;
  line: number;
  marker: string;
  indent: string;
  newline: string;
}

export interface TabGroupInfo {
  id: string;
  lineStart: number;
}

// 原生 embed 不在 Obsidian 公开类型中，只声明本插件实际使用的部分。
// Obsidian 公开类型都有哪些呢?
export interface NativeMarkdownEmbed extends Component {
  editable: boolean;
  editor?: Editor & { cm?: EditorView };
  showEditor(): void;
}

export interface MarkdownEmbedOptions {
  extension: string;
}

export interface MarkdownEmbedContext {
  app: App;
  linktext: null;
  sourcePath: string;
  containerEl: HTMLElement;
  displayMode: boolean;
  showInline: boolean;
  depth: number;
}

export interface AppWithEmbedRegistry extends App {
  embedRegistry?: {
    getEmbedCreator(options: MarkdownEmbedOptions): ((
      context: MarkdownEmbedContext,
      file: null
    ) => NativeMarkdownEmbed) | undefined;
  };
}
