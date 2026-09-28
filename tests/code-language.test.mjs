import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/components/CodeBlockEditor/language.ts", import.meta.url)),
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { getCodeLanguage, normalizeCodeLanguage, replaceCodeLanguage } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
);

test("语言修改只替换标记，保留正文、围栏及附加信息", () => {
  for (const marker of ["`", "~"]) {
    const source =
      "  " + marker.repeat(4) + "c++ title=example\n\n  code\n\n " + marker.repeat(5) + "  ";
    assert.equal(getCodeLanguage(source), "c++");
    assert.equal(replaceCodeLanguage(source, "python"), source.replace("c++", "python"));
  }
});

test("无语言的空代码块也能设置语言，混合内容不开放单一语言修改", () => {
  const source = "```\n\n```";
  assert.equal(getCodeLanguage(source), "");
  assert.equal(replaceCodeLanguage(source, "c#"), "```c#\n\n```");
  assert.equal(getCodeLanguage("文字\n" + source), null);
  assert.throws(() => replaceCodeLanguage("文字\n" + source, "python"));
});

test("允许常见别名、未知语言及留空，不允许语言输入改变 Markdown 结构", () => {
  for (const language of [
    "c++",
    "c#",
    "objective-c",
    "custom.language",
    "unknown_lang",
    "自定义-renderer",
    "$custom",
  ]) {
    assert.equal(normalizeCodeLanguage(language), language);
  }
  assert.equal(replaceCodeLanguage("```text\ncode\n```", "$custom"), "```$custom\ncode\n```");
  assert.equal(normalizeCodeLanguage(" Python "), "python");
  assert.equal(normalizeCodeLanguage("  "), "text");
  for (const language of ["python\ntab: inserted", "js```", "python title", "~js"]) {
    assert.equal(normalizeCodeLanguage(language), null);
    assert.throws(() => replaceCodeLanguage("```text\ncode\n```", language));
  }
});
