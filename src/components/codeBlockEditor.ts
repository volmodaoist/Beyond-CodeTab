import { EditorSelection, EditorState, Prec, StateField } from "@codemirror/state";
import type { Extension, Range, Text, TransactionSpec } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import type { DecorationSet, KeyBinding } from "@codemirror/view";

export interface CodeBlockBody {
  from: number;
  to: number;
}

/**
 * 仅为“整个标签就是一个代码块”的情况提供正文编辑。
 * 围栏仍保存在原生 Markdown 文档中，语法高亮和保存均使用完整文档。
 * 多代码块、混合 Markdown 或不完整的围栏继续显示全文，避免隐藏用户正文。
 */
export function findCodeBlockBody(source: string): CodeBlockBody | null {
  const lines = source.split("\n");
  if (lines.length < 3) return null;

  const opening = lines[0].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!opening) return null;
  const marker = opening[1][0];
  const length = opening[1].length;
  if (marker === "`" && opening[2].includes("`")) return null;

  for (let index = 1; index < lines.length; index += 1) {
    const closing = lines[index].match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    if (!closing || closing[1][0] !== marker || closing[1].length < length) continue;
    if (index !== lines.length - 1) return null;

    const body: CodeBlockBody = {
      from: lines[0].length + 1,
      to: source.length - lines[index].length - 1,
    };

    return body;
  }

  return null;
}

function foldedFences(doc: Text): DecorationSet {
  const body = findCodeBlockBody(doc.toString());
  if (!body) return Decoration.none;

  // 用 CodeMirror 的替换装饰连同换行一起折叠，编辑器能够正确计算光标、选区和滚动位置。
  // 不直接给 .cm-line 设置 display:none，那会让 DOM 高度与编辑器的行模型不一致。
  type ReplaceOptions = Parameters<typeof Decoration.replace>[0];
  const options: ReplaceOptions = {
    inclusive: false,
  };
  const replacement = Decoration.replace(options);
  const ranges: Range<Decoration>[] = [
    replacement.range(0, body.from),
    replacement.range(body.to, doc.length),
  ];

  return Decoration.set(ranges);
}

type FenceFieldDefinition = Parameters<typeof StateField.define<DecorationSet>>[0];
const fenceFieldDefinition: FenceFieldDefinition = {
  create(state) {
    return foldedFences(state.doc);
  },
  update(value, transaction) {
    return transaction.docChanged ? foldedFences(transaction.newDoc) : value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
};
const fenceField = StateField.define(fenceFieldDefinition);

/**
 * 每个临时编辑器安装一组独立扩展，编辑器卸载时一起释放。
 * 光标跳过隐藏的围栏；全选、退格和粘贴也只能修改代码正文，围栏不会意外丢失。
 */
export function codeBlockEditorExtensions(): Extension[] {
  const selectBody: KeyBinding = {
    key: "Mod-a",
    run(view) {
      const body = findCodeBlockBody(view.state.doc.toString());
      if (!body) return false;
      // 全选限定为可见正文，随后粘贴/替换不会把插入位置落到受保护的开头围栏里。
      const transaction: TransactionSpec = {
        selection: EditorSelection.single(body.from, body.to),
      };
      view.dispatch(transaction);
      return true;
    },
  };
  const extensions: Extension[] = [
    Prec.highest(keymap.of([selectBody])),
    fenceField,
    EditorView.atomicRanges.of((view) => view.state.field(fenceField)),
    EditorState.changeFilter.of((transaction) => {
      const body = findCodeBlockBody(transaction.startState.doc.toString());
      if (!body) return true;
      return [0, body.from, body.to, transaction.startState.doc.length];
    }),
  ];

  return extensions;
}
