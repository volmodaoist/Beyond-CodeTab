import { findCodeBlockBody } from "../CodeBlockEditor";
import type { CodeBlockBody } from "../CodeBlockEditor";
import { getCodeLanguage, replaceCodeLanguage } from "../CodeBlockEditor";

export interface TabContent {
  /** 笔记中保存的原文，用于保留围栏与附加信息。 */
  source: string;
  /** 交给原生编辑器的文档；Markdown 围栏会解包，代码围栏保留供边界保护使用。 */
  editorSource: string;
  renderType: string;
  kind: "code" | "markdown";
  /** 原始单围栏的正文范围；混合 Markdown 没有这个范围。 */
  body: CodeBlockBody | null;
}

export function isMarkdownType(renderType: string): boolean {
  return renderType === "md" || renderType === "markdown";
}

/**
 * 标签正文只有两种编辑方式：完整 Markdown，或单个围栏中的正文。
 * md/markdown 围栏按 Markdown 展示；其他围栏名保留给 Obsidian 的代码或插件渲染器。
 * 不为表格、图片、画布再造格式，继续使用标准 Markdown 和 ![[文件]] 嵌入语法。
 */
export function readTabContent(source: string): TabContent {
  const body = findCodeBlockBody(source);
  const renderType = body ? getCodeLanguage(source) || "text" : "markdown";
  const markdown = !body || isMarkdownType(renderType);
  const content: TabContent = {
    source,
    editorSource: markdown && body ? source.slice(body.from, body.to) : source,
    renderType,
    kind: markdown ? "markdown" : "code",
    body,
  };

  return content;
}

/** 保存时转换一次格式；输入类型名不会销毁正在使用的编辑器或正文撤销历史。 */
export function writeTabContent(content: TabContent, edited: string, renderType: string): string {
  const body = content.kind === "code" ? findCodeBlockBody(edited) : null;
  const text = body ? edited.slice(body.from, body.to) : edited;
  if (isMarkdownType(renderType)) {
    // 已有 Markdown 围栏且类型未改时保留原有格式；代码切换到 Markdown 时释放外层围栏。
    if (content.kind === "markdown" && content.body && renderType === content.renderType) {
      return (
        content.source.slice(0, content.body.from) + text + content.source.slice(content.body.to)
      );
    }
    return text;
  }
  if (content.kind === "code" && body) {
    if (renderType === content.renderType) {
      return edited;
    }
    return replaceCodeLanguage(edited, renderType);
  }

  // Markdown 切换到代码时，围栏必须长于正文中的反引号，避免嵌套内容提前关闭新围栏。
  let length = 3;
  for (const marks of text.match(/^ {0,3}`+/gm) || []) {
    length = Math.max(length, marks.trim().length + 1);
  }
  const fence = "`".repeat(length);
  return fence + renderType + "\n" + text + "\n" + fence;
}
