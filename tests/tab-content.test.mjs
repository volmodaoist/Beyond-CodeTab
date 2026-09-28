import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/components/MultiTab/tabContent.ts", import.meta.url)),
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { readTabContent, writeTabContent } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
);

const table = "| 标识 | 说明 |\n| --- | --- |\n| id | 标识符 |";

test("普通 Markdown、表格和画布链接保留全文，不需要代码围栏", () => {
  for (const source of [
    table,
    "![[Drawing.excalidraw.md]]",
    "段落\n\n```python\nprint(1)\n```",
    "",
  ]) {
    const content = readTabContent(source);
    assert.equal(content.kind, "markdown");
    assert.equal(content.editorSource, source);
    assert.equal(writeTabContent(content, source, "markdown"), source);
  }
});

test("md 与 markdown 围栏渲染正文，编辑后保留原围栏和附加信息", () => {
  for (const type of ["md", "markdown"]) {
    const source = "~~~~" + type + " title=example\n" + table + "\n~~~~";
    const content = readTabContent(source);
    assert.equal(content.kind, "markdown");
    assert.equal(content.editorSource, table);
    assert.equal(writeTabContent(content, table + "\n", type), source.replace(table, table + "\n"));
  }
});

test("代码改为 markdown 后正文直接渲染；改回代码时保护正文中的嵌套围栏", () => {
  const source = "```text\n" + table + "\n```";
  assert.equal(writeTabContent(readTabContent(source), source, "md"), table);
  const markdown = table + "\n\n```python\nprint(1)\n```";
  const code = writeTabContent(readTabContent(markdown), markdown, "text");
  assert.equal(code, "````text\n" + markdown + "\n````");
  assert.equal(writeTabContent(readTabContent(code), code, "markdown"), markdown);
});

test("其他处理器保持围栏语法，代码与正文空行不被重写", () => {
  const source = "~~~mermaid\ngraph LR\n A --> B\n\n~~~";
  const content = readTabContent(source);
  assert.equal(content.kind, "code");
  assert.equal(content.editorSource, source);
  assert.equal(writeTabContent(content, source, "mermaid"), source);
  assert.equal(
    writeTabContent(content, source, "自定义-renderer"),
    source.replace("mermaid", "自定义-renderer"),
  );
});
