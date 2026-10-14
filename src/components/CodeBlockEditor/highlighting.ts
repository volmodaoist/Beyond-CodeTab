import { Prec, StateField } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import type * as Prism from "prismjs";
import { findCodeBlockBody } from "./fences";

export interface CodeHighlighting {
  language: string | null;
  extension: Extension;
}

interface CodeRange {
  from: number;
  to: number;
  language: string;
}

interface TokenizationEnvironment extends Prism.Environment {
  code: string;
  grammar: Prism.Grammar;
  language: string;
  tokens?: Prism.TokenStream;
}

/**
 * 使用宿主预览器的 Prism 语法定义，为原生编辑器的代码正文添加着色装饰。
 * 这里只添加 mark，不替换文字或 DOM 输入层；光标、输入法和撤销仍由 CodeMirror 管理。
 * Prism 由调用方通过 Obsidian 的 loadPrism 获取，插件不会再打包一套语法定义。
 */
export function codeHighlighting(prism: typeof Prism, language: string): CodeHighlighting {
  const highlight = (source: string): DecorationSet => {
    const body = findCodeBlockBody(source);
    if (!body) {
      return Decoration.none;
    }
    const ranges: Range<Decoration>[] = [];
    const code: CodeRange = {
      from: body.from,
      to: body.to,
      language,
    };
    appendPrismRanges(prism, source, code, ranges);
    return Decoration.set(ranges, true);
  };

  type HighlightFieldDefinition = Parameters<typeof StateField.define<DecorationSet>>[0];
  const definition: HighlightFieldDefinition = {
    create(state) {
      return highlight(state.doc.toString());
    },
    update(value, transaction) {
      // 移动光标不需要重新分词；输入、粘贴和撤销改变正文时再更新着色。
      return transaction.docChanged ? highlight(transaction.newDoc.toString()) : value;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  };
  // 高优先级 mark 位于宿主语法装饰内侧，配合局部样式只显示这一套 token 颜色。
  const result: CodeHighlighting = {
    language,
    extension: Prec.highest(StateField.define(definition)),
  };

  return result;
}

/** 混合 Markdown 中的每个围栏独立按其语言使用 Prism 着色，正文仍由宿主渲染。 */
export function mixedCodeHighlighting(prism: typeof Prism): CodeHighlighting {
  const highlight = (source: string): DecorationSet => {
    const ranges: Range<Decoration>[] = [];
    for (const code of findFencedCodeRanges(source)) {
      appendPrismRanges(prism, source, code, ranges);
    }
    return Decoration.set(ranges, true);
  };
  type HighlightFieldDefinition = Parameters<typeof StateField.define<DecorationSet>>[0];
  const definition: HighlightFieldDefinition = {
    create(state) {
      return highlight(state.doc.toString());
    },
    update(value, transaction) {
      return transaction.docChanged ? highlight(transaction.newDoc.toString()) : value;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  };
  const result: CodeHighlighting = {
    language: null,
    extension: Prec.highest(StateField.define(definition)),
  };
  return result;
}

function appendPrismRanges(
  prism: typeof Prism,
  source: string,
  code: CodeRange,
  ranges: Range<Decoration>[],
): void {
  const grammar = prism.languages[code.language];
  if (!grammar) {
    return;
  }
  const environment: TokenizationEnvironment = {
    code: source.slice(code.from, code.to),
    grammar,
    language: code.language,
  };
  prism.hooks.run("before-tokenize", environment);
  environment.tokens = prism.tokenize(environment.code, environment.grammar);
  prism.hooks.run("after-tokenize", environment);

  const visit = (token: Prism.TokenStream, from: number): number => {
    if (typeof token === "string") {
      return from + token.length;
    }
    if (Array.isArray(token)) {
      let offset = from;
      for (const child of token) {
        offset = visit(child, offset);
      }
      return offset;
    }
    const to = visit(token.content, from);
    if (to > from) {
      const aliases = typeof token.alias === "string" ? [token.alias] : token.alias || [];
      const classes = ["code-tab__syntax", "token", token.type, ...aliases];
      type MarkOptions = Parameters<typeof Decoration.mark>[0];
      const options: MarkOptions = {
        class: classes.join(" "),
      };
      ranges.push(Decoration.mark(options).range(from, to));
    }
    return to;
  };
  visit(environment.tokens, code.from);
}

function findFencedCodeRanges(source: string): CodeRange[] {
  const lines = source.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const ranges: CodeRange[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === "`" && opening[2].includes("`"))) {
      continue;
    }
    const marker = opening[1][0];
    const markerLength = opening[1].length;
    const rawLanguage = opening[2].trim().split(/\s/u)[0].toLowerCase();
    const aliases: Record<string, string> = {
      "c++": "cpp",
      "c#": "csharp",
    };
    const language = aliases[rawLanguage] || rawLanguage;
    for (let closingIndex = index + 1; closingIndex < lines.length; closingIndex += 1) {
      const closing = lines[closingIndex].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (!closing || closing[1][0] !== marker || closing[1].length < markerLength) {
        continue;
      }
      const from = offsets[index] + lines[index].length + 1;
      const range: CodeRange = {
        from,
        to: Math.max(from, offsets[closingIndex] - 1),
        language,
      };
      ranges.push(range);
      index = closingIndex;
      break;
    }
  }
  return ranges;
}
