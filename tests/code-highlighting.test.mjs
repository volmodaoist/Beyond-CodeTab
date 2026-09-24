import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import Prism from "prismjs";
import "prismjs/components/prism-python.js";

const compiled = await build({
  stdin: {
    contents: `
      export { EditorState } from "@codemirror/state";
      export { EditorView } from "@codemirror/view";
      export { codeHighlighting } from "./src/components/codeHighlighting";
    `,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { EditorState, EditorView, codeHighlighting } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
);

function tokens(state) {
  const result = [];
  const decorations = state.facet(EditorView.decorations)[0];
  const cursor = decorations.iter();
  while (cursor.value) {
    result.push({ text: state.doc.sliceString(cursor.from, cursor.to), classes: cursor.value.spec.class.split(" ") });
    cursor.next();
  }
  return result;
}

test("Python 着色使用预览的分类，Unicode 字符不影响后续 token 偏移", () => {
  const source = '```python\nprint(len("中文😀")) # 注释\n```';
  const state = EditorState.create({ doc: source, extensions: codeHighlighting(Prism, "python").extension });
  const result = tokens(state);
  for (const [text, type] of [["print", "keyword"], ["len", "builtin"], ['"中文😀"', "string"], ["# 注释", "comment"]]) {
    assert.ok(result.some((token) => token.text === text && token.classes.includes(type)), text);
  }
  assert.equal(state.doc.toString(), source, "着色不修改源文或围栏");
});

test("编辑后按新内容重新着色，不保留旧字符串的颜色", () => {
  const source = '```python\nvalue = "old"\n```';
  let state = EditorState.create({ doc: source, extensions: codeHighlighting(Prism, "python").extension });
  const from = source.indexOf('"old"');
  state = state.update({ changes: { from, to: from + '"old"'.length, insert: "42" } }).state;
  assert.ok(tokens(state).some((token) => token.text === "42" && token.classes.includes("number")));
  assert.ok(tokens(state).every((token) => !token.classes.includes("string")));
});

test("JavaScript 模板字符串保留嵌套表达式的 token", () => {
  const source = '```javascript\nconst value = `hello ${name.toUpperCase()}`;\n```';
  const state = EditorState.create({ doc: source, extensions: codeHighlighting(Prism, "javascript").extension });
  const result = tokens(state);
  assert.ok(result.some((token) => token.text === "toUpperCase" && token.classes.includes("function")));
  assert.ok(result.some((token) => token.text.includes("${name") && token.classes.includes("interpolation")));
  assert.equal(state.doc.toString(), source);
});

test("未知语言和混合 Markdown 不套用单代码块着色", () => {
  for (const [source, language] of [["```unknown\nprint(1)\n```", "unknown"], ["段落\n```python\nprint(1)\n```", "python"]]) {
    const state = EditorState.create({ doc: source, extensions: codeHighlighting(Prism, language).extension });
    assert.deepEqual(tokens(state), []);
    assert.equal(state.doc.toString(), source);
  }
});
