import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 直接测试当前 TypeScript 源码，避免误测上一次构建遗留的文件。
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/markdown.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const {
  createTabFence,
  findTabBlock,
  normalizePreviewFenceLanguages,
  parseTabs,
  serializeTabs,
  updateMarkdownSource,
} = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
);

const backticks = String.fromCharCode(96);

function createVault(
  content,
  {
    process = true,
    file = {
      extension: "md",
    },
  } = {},
) {
  let current = content;
  const calls = [];
  const vault = {
    getAbstractFileByPath(path) {
      calls.push(["lookup", path]);
      return file;
    },
    async read(target) {
      assert.equal(target, file);
      calls.push(["read"]);
      return current;
    },
    async modify(target, value) {
      assert.equal(target, file);
      calls.push(["modify"]);
      current = value;
    },
  };
  if (process) {
    vault.process = async (target, update) => {
      assert.equal(target, file);
      calls.push(["process"]);
      current = update(current);
      return current;
    };
  }
  return {
    app: {
      vault,
    },
    calls,
    content: () => current,
  };
}

test("标签解析保留正文内部空行，并为无标题标签生成名称", () => {
  const tabs = parseTabs(
    [
      "说明文字",
      "  tab: 简介  ",
      "",
      "第一段",
      "",
      "  缩进正文",
      "  ",
      "tab:   ",
      "",
      "第二段",
      "",
      "tab: 空标签",
    ].join("\r\n"),
  );
  assert.deepEqual(tabs, [
    {
      title: "简介",
      content: "第一段\n\n  缩进正文",
    },
    {
      title: "标签2",
      content: "第二段",
    },
    {
      title: "空标签",
      content: "",
    },
  ]);
  assert.deepEqual(parseTabs("没有标签\n正文中的 tab: 不是声明"), []);
  assert.deepEqual(parseTabs(serializeTabs(tabs)), tabs);
});

for (const marker of [backticks, "~"]) {
  test("内部代码块中的 tab: 不分割标签，围栏标记为 " + marker, () => {
    const code = [
      marker.repeat(4) + "text",
      "tab: code",
      marker.repeat(3),
      "tab: still code",
      marker.repeat(4),
    ].join("\n");
    const tabs = parseTabs("tab: 示例\n" + code + "\n\ntab: 结尾\n完成");
    assert.deepEqual(tabs, [
      {
        title: "示例",
        content: code,
      },
      {
        title: "结尾",
        content: "完成",
      },
    ]);
    const fenced = createTabFence(serializeTabs(tabs), marker, "  ");
    assert.ok(fenced.startsWith("  " + marker.repeat(5) + "tab\n"));
    assert.ok(fenced.endsWith("\n  " + marker.repeat(5)));
  });
}

test("预览语言别名不改变用于保存的标签内容", () => {
  const source = [
    "tab: 语言",
    backticks.repeat(3) + "c++",
    "int main() {}",
    backticks.repeat(3),
    "~~~C# title",
    "class Example {}",
    "~~~",
    "正文 c++ 和 c#",
  ].join("\n");
  const tabs = parseTabs(source);
  const preview = normalizePreviewFenceLanguages(tabs[0].content);
  assert.ok(preview.includes(backticks.repeat(3) + "cpp\n"));
  assert.ok(preview.includes("~~~csharp title\n"));
  assert.ok(preview.includes("正文 c++ 和 c#"));
  assert.equal(serializeTabs(tabs), source);
});

test("标签分组保留普通 Markdown、多个代码块及代码块之后的正文", () => {
  const content = [
    "## 示例",
    "",
    "这里是 **加粗文字**。",
    "",
    "- 第一项",
    "- 第二项",
    "",
    backticks.repeat(3) + "python",
    'print("hello")',
    backticks.repeat(3),
    "",
    "代码后面的段落包含 tab:，但不是标签声明。",
    "",
    "~~~text",
    "tab: 代码里的声明",
    "~~~",
    "",
    "> 引用内容",
  ].join("\n");
  assert.deepEqual(parseTabs("tab: 示例\n" + content + "\n\ntab: 说明\n最后一段"), [
    {
      title: "示例",
      content,
    },
    {
      title: "说明",
      content: "最后一段",
    },
  ]);
});

test("连续标签与末尾空标签不会因下标推进被跳过", () => {
  assert.deepEqual(parseTabs("tab: 第一页\ntab: 第二页\n内容\ntab:"), [
    {
      title: "第一页",
      content: "",
    },
    {
      title: "第二页",
      content: "内容",
    },
    {
      title: "标签3",
      content: "",
    },
  ]);
});

for (const marker of [backticks, "~"]) {
  test("标签分组正确识别带缩进且更长的结束围栏，标记为 " + marker, () => {
    const otherMarker = marker === backticks ? "~" : backticks;
    const code = [
      "  " + marker.repeat(4) + "text",
      otherMarker.repeat(4),
      "tab: 不同字符不能结束",
      marker.repeat(3),
      "tab: 较短围栏不能结束",
      marker.repeat(4) + "python",
      "tab: 带语言名不能结束",
      "  " + marker.repeat(5) + "  ",
    ].join("\n");
    assert.deepEqual(parseTabs("tab: 示例\n" + code + "\ntab: 下一个\n正文"), [
      {
        title: "示例",
        content: code,
      },
      {
        title: "下一个",
        content: "正文",
      },
    ]);
  });

  test("未闭合围栏内的 tab: 保留到正文末尾，标记为 " + marker, () => {
    const content = [marker.repeat(3) + "text", "正文", "tab: 仍然属于代码块"].join("\n");
    assert.deepEqual(parseTabs("tab: 示例\n" + content), [
      {
        title: "示例",
        content,
      },
    ]);
  });

  test("首个标签之前的代码块不产生标签，标记为 " + marker, () => {
    const preamble = [marker.repeat(3) + "text", "tab: 代码中的声明"].join("\n");
    assert.deepEqual(parseTabs(preamble), []);
    assert.deepEqual(parseTabs(preamble + "\n" + marker.repeat(3) + "\ntab: 真正的标签\n正文"), [
      {
        title: "真正的标签",
        content: "正文",
      },
    ]);
  });
}

for (const newline of ["\n", "\r\n"]) {
  test("多块保存只修改距离原行号最近的匹配块，保留 " + JSON.stringify(newline), async () => {
    const previous = "tab: 相同标题\n旧内容";
    const next = "tab: 相同标题\n新内容";
    const oldBlock = createTabFence(previous, backticks, "", newline);
    const newBlock = createTabFence(next, backticks, "", newline);
    const prefix = ["# 开头", oldBlock, "", "段落", ""].join(newline);
    const suffix = newline + "原样保留结尾" + newline;
    const content = prefix + oldBlock + suffix;
    const line = prefix.split(newline).length - 1;
    const vault = createVault(content);
    // 模拟块之前插入了两行，保存仍按旧内容与最近行号定位。
    assert.equal(findTabBlock(content, previous, line - 2).start, prefix.length);
    await updateMarkdownSource(vault.app, "笔记/示例.md", line - 2, previous, next);
    assert.equal(vault.content(), prefix + newBlock + suffix);
    assert.deepEqual(vault.calls, [["lookup", "笔记/示例.md"], ["process"]]);
  });
}

test("保存保留波浪围栏及缩进，内部新增围栏时扩展外层围栏", async () => {
  const previous = "tab: 示例\n旧内容";
  const next = "tab: 示例\n~~~text\n示例代码\n~~~";
  const vault = createVault("前言\n" + createTabFence(previous, "~", "  ") + "\n后记");
  await updateMarkdownSource(vault.app, "示例.md", 1, previous, next);
  assert.equal(vault.content(), "前言\n  ~~~~tab\n" + next + "\n  ~~~~\n后记");
});

for (const process of [true, false]) {
  test("源内容已被其他编辑修改时拒绝覆盖，vault.process=" + process, async () => {
    const content = createTabFence("tab: 示例\n其他窗格的新内容", backticks, "");
    const vault = createVault(content, {
      process,
    });
    await assert.rejects(
      updateMarkdownSource(vault.app, "示例.md", 0, "tab: 示例\n旧内容", "tab: 示例\n待保存"),
      /原标签块已发生变化/,
    );
    assert.equal(vault.content(), content);
    assert.equal(
      vault.calls.some(([action]) => action === "modify"),
      false,
    );
  });
}

test("旧版 Vault 没有 process 时仍可读改写", async () => {
  const previous = "tab: 示例\n旧内容";
  const next = "tab: 示例\n新内容";
  const vault = createVault(createTabFence(previous, backticks, ""), {
    process: false,
  });
  await updateMarkdownSource(vault.app, "示例.md", 0, previous, next);
  assert.equal(vault.content(), createTabFence(next, backticks, ""));
  assert.deepEqual(vault.calls, [["lookup", "示例.md"], ["read"], ["modify"]]);
});

test("文件缺失、目录和非 Markdown 文件不会写入", async () => {
  for (const file of [
    null,
    {
      children: [],
    },
    {
      extension: "png",
    },
  ]) {
    const vault = createVault("未改动", {
      file,
    });
    await assert.rejects(updateMarkdownSource(vault.app, "示例.md", 0, "旧", "新"), /无法定位/);
    assert.equal(vault.content(), "未改动");
    assert.deepEqual(vault.calls, [["lookup", "示例.md"]]);
  }
});

for (const newline of ["\n", "\r\n"]) {
  test("删除整个标签块时只移除目标，并保留其他内容与换行 " + JSON.stringify(newline), async () => {
    const source = "tab: 最后一页\n内容";
    const target = createTabFence(source, "`", "", newline);
    const other = createTabFence("tab: 保留\nuntouched", "`", "", newline);
    const prefix = "前文" + newline;
    const suffix = newline + "后文" + newline + other + newline;
    const vault = createVault(prefix + target + suffix);
    await updateMarkdownSource(vault.app, "Test.md", 1, source, null);
    assert.equal(vault.content(), prefix + suffix);
  });
}

test("删除也必须匹配旧内容，冲突时不移除文件中的块", async () => {
  const content = createTabFence("tab: 最后一页\n其他窗口的新内容", "`", "");
  const vault = createVault(content);
  await assert.rejects(
    updateMarkdownSource(vault.app, "Test.md", 0, "tab: 最后一页\n旧内容", null),
    /已发生变化/,
  );
  assert.equal(vault.content(), content);
});
