import { findCodeBlockBody } from "./codeBlockEditor";

/** 只识别整个标签中的单个代码块，混合 Markdown 没有唯一的语言可修改。 */
export function getCodeLanguage(source: string): string | null {
  if (!findCodeBlockBody(source)) return null;
  const opening = source.match(/^ {0,3}(?:`{3,}|~{3,})[\t ]*([^\s]*)/);
  return opening ? opening[1] : null;
}

/** 空输入使用 text；允许 Prism 别名与自定义语言名，但不允许注入围栏或附加行。 */
export function normalizeCodeLanguage(value: string): string | null {
  const language = value.trim().toLowerCase();
  if (!language) return "text";
  return /^[a-z0-9_+#.-]+$/.test(language) ? language : null;
}

/** 只替换开头的语言名，保留围栏长度、缩进、附加信息及正文中的全部空白。 */
export function replaceCodeLanguage(source: string, language: string): string {
  if (getCodeLanguage(source) === null || normalizeCodeLanguage(language) !== language) {
    throw new Error("无效的代码块或编程语言");
  }
  return source.replace(/^( {0,3}(?:`{3,}|~{3,})[\t ]*)([^\s]*)/, "$1" + language);
}
