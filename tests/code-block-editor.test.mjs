import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 将被测扩展和 EditorState 一起打包，保证它们使用同一份 CodeMirror 实例。
const compiled = await build({
  stdin: {
    contents: `
      export { EditorState } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export * from "./src/components/codeBlockEditor";
    `,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { EditorState, EditorView, codeBlockEditorExtensions, findCodeBlockBody } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
);

const ticks = String.fromCharCode(96);

test("纯代码块只选择正文，保留围栏、缩进、语言和尾部空格", () => {
  for (const marker of [ticks, "~"]) {
    const source = "  " + marker.repeat(4) + "c++ title\n第一行\n\n最后一行\n " + marker.repeat(5) + "  ";
    const body = findCodeBlockBody(source);
    assert.equal(source.slice(body.from, body.to), "第一行\n\n最后一行");
    const edited = source.slice(0, body.from) + "替换正文" + source.slice(body.to);
    assert.equal(edited, "  " + marker.repeat(4) + "c++ title\n替换正文\n " + marker.repeat(5) + "  ");
  }
});

test("混合 Markdown、多代码块和未闭合代码块继续编辑完整源文", () => {
  const code = ticks.repeat(3) + "python\nprint(1)\n" + ticks.repeat(3);
  for (const source of ["段落\n" + code, code + "\n段落", code + "\n\n" + code, ticks.repeat(3) + "python\nprint(1)", "普通文本"]) {
    assert.equal(findCodeBlockBody(source), null);
  }
});

test("空代码行仍是可编辑的正文", () => {
  const source = ticks.repeat(3) + "python\n\n" + ticks.repeat(3);
  const body = findCodeBlockBody(source);
  assert.equal(body.from, body.to);
  const state = EditorState.create({ doc: source, extensions: codeBlockEditorExtensions() });
  const edited = state.update({ changes: { from: body.from, insert: "print(1)" } }).state;
  assert.equal(edited.doc.toString(), ticks.repeat(3) + "python\nprint(1)\n" + ticks.repeat(3));
});

test("正文可以连续增删，围栏折叠随文档长度更新", () => {
  const source = ticks.repeat(3) + "python\nprint(1)\n" + ticks.repeat(3);
  let state = EditorState.create({ doc: source, extensions: codeBlockEditorExtensions() });
  let body = findCodeBlockBody(source);
  state = state.update({ changes: { from: body.to, insert: "\nprint(2)" } }).state;
  body = findCodeBlockBody(state.doc.toString());
  assert.equal(state.doc.sliceString(body.from, body.to), "print(1)\nprint(2)");
  const decorations = state.facet(EditorView.decorations)[0];
  assert.equal(decorations.size, 2);
  state = state.update({ changes: { from: body.from, to: body.to, insert: "" } }).state;
  assert.equal(state.doc.toString(), ticks.repeat(3) + "python\n\n" + ticks.repeat(3));
});

test("全选删除不会删除隐藏的围栏", () => {
  const source = ticks.repeat(3) + "python\nprint(1)\n" + ticks.repeat(3);
  const state = EditorState.create({ doc: source, extensions: codeBlockEditorExtensions() });
  const edited = state.update({ changes: { from: 0, to: state.doc.length, insert: "" } }).state;
  assert.equal(edited.doc.toString(), ticks.repeat(3) + "python\n\n" + ticks.repeat(3));
});

test("正文两端退格不能合并隐藏的围栏行", () => {
  const source = ticks.repeat(3) + "python\nprint(1)\n" + ticks.repeat(3);
  const body = findCodeBlockBody(source);
  const state = EditorState.create({ doc: source, extensions: codeBlockEditorExtensions() });
  for (const changes of [{ from: body.from - 1, to: body.from }, { from: body.to, to: body.to + 1 }]) {
    assert.equal(state.update({ changes }).state.doc.toString(), source);
  }
});

test("跳到文末后粘贴仍落在代码正文末尾", () => {
  const source = ticks.repeat(3) + 'python\nprint("hello tab1")\n' + ticks.repeat(3);
  let state = EditorState.create({ doc: source, extensions: codeBlockEditorExtensions() });
  // 对应真实宿主的 Cmd+↓ / Ctrl+End，不能停在隐藏结束围栏的后面。
  state = state.update({ selection: { anchor: state.doc.length } }).state;
  assert.equal(state.selection.main.head, findCodeBlockBody(source).to);
  state = state.update(state.replaceSelection('\nprint("hello")')).state;
  assert.equal(state.doc.toString(), ticks.repeat(3) + 'python\nprint("hello tab1")\nprint("hello")\n' + ticks.repeat(3));
});

test("跳到文首和跨围栏选择均限定到可见正文", () => {
  const source = ticks.repeat(3) + "python\nprint(1)\n" + ticks.repeat(3);
  let state = EditorState.create({ doc: source, extensions: codeBlockEditorExtensions() });
  state = state.update({ selection: { anchor: 0 } }).state;
  assert.equal(state.selection.main.head, findCodeBlockBody(source).from);
  state = state.update({ selection: { anchor: state.doc.length, head: 0 } }).state;
  assert.equal(state.selection.main.anchor, findCodeBlockBody(source).to);
  assert.equal(state.selection.main.head, findCodeBlockBody(source).from);
  state = state.update(state.replaceSelection("替换内容")).state;
  assert.equal(state.doc.toString(), ticks.repeat(3) + "python\n替换内容\n" + ticks.repeat(3));
});

test("宿主直接向文档两端插入内容也不能破坏围栏", () => {
  const source = ticks.repeat(3) + "python\nprint(1)\n" + ticks.repeat(3);
  const state = EditorState.create({ doc: source, extensions: codeBlockEditorExtensions() });
  for (const from of [0, 3, state.doc.length - 1, state.doc.length]) {
    const edited = state.update({ changes: { from, insert: "print(2)" } }).state;
    assert.equal(edited.doc.toString(), source);
  }
});
