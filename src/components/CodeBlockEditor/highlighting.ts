import { Prec, StateField } from "@codemirror/state";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import type * as Prism from "prismjs";
import { findCodeBlockBody } from "./fences";

export interface CodeHighlighting {
  language: string;
  extension: Extension;
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
    const grammar = prism.languages[language];
    if (!body || !grammar) {
      return Decoration.none;
    }

    const environment: TokenizationEnvironment = {
      code: source.slice(body.from, body.to),
      grammar,
      language,
    };
    // 与 Prism.highlight 保持同样的分词钩子顺序，兼容嵌套语言的语法预处理。
    prism.hooks.run("before-tokenize", environment);
    environment.tokens = prism.tokenize(environment.code, environment.grammar);
    prism.hooks.run("after-tokenize", environment);

    const ranges: Range<Decoration>[] = [];
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

      // 嵌套 token 也保留自己的 class，例如模板字符串中的插值表达式。
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
    visit(environment.tokens, body.from);
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
