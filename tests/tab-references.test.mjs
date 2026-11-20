import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({
  stdin: {
    contents:
      'export * from "./src/markdown"; export * from "./src/components/MultiTab/tabReferences"; export * from "./src/openapi/operations";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  createTabReference,
  resolveReferencedTab,
  parseTabs,
  serializeTabs,
  applyTabOperations,
  updateMarkdownSource,
  findReferencedTab,
} = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

const body = "tab: 同名\n```python\nprint(1)\n```\n\ntab: 同名\n正文";
function fixture(text) {
  const file = {
    path: "笔记.md",
    extension: "md",
  };
  const state = {
    text,
    writes: 0,
  };
  const app = {
    vault: {
      getFileByPath: () => file,
      getAbstractFileByPath: () => file,
      getName: () => "测试库",
      getMarkdownFiles: () => [file],
      read: async () => state.text,
      cachedRead: async () => state.text,
      process: async (_file, update) => {
        state.writes += 1;
        state.text = update(state.text);
      },
    },
  };
  return {
    app,
    state,
  };
}

test("标签引用使用原生组锚点和带组前缀的稳定 tab ID，正文不混入元数据", async () => {
  const { app, state } = fixture("# 说明\n\n````tab\n" + body + "\n````\n");
  const result = await createTabReference(app, "笔记.md", 2, body, 1);
  assert.match(result.blockId, /^[0-9a-f]{6}$/);
  assert.match(result.tabId, new RegExp("^" + result.blockId + "-[0-9a-f]{6}$"));
  const uri = new URL(result.link.slice(result.link.indexOf("(") + 1, -1));
  assert.deepEqual(Object.fromEntries(uri.searchParams), {
    block: result.blockId,
    tab: result.tabId.slice(7),
  });
  assert.ok(state.text.includes("\n^" + result.blockId));
  assert.ok(result.source.includes("tab: 同名 ^" + result.tabId + "\n正文"));
  assert.equal(result.source.includes("<!-- beyond-code-tab:"), false);
  assert.equal(parseTabs(result.source)[1].content, "正文");
  assert.deepEqual(
    resolveReferencedTab(state.text, result.blockId, result.tabId.slice(result.blockId.length + 1)),
    {
      line: 2,
      index: 1,
      anchorLine: 11,
    },
  );
  const repeated = await createTabReference(app, "笔记.md", 2, result.source, 1);
  assert.equal(repeated.link, result.link);
  assert.equal(repeated.source, result.source);
  assert.equal(state.writes, 1);
});

test("标题末尾 ID 单独解析，代码正文中的 tab 和普通标题不被误改", () => {
  const source =
    "tab: C# ^group-tab-one\n```shell\ntab: 正文 ^not-a-tab\n```\n\ntab: x^2\n正文\n\ntab: ^group-tab-empty";
  const tabs = parseTabs(source);
  assert.deepEqual(tabs, [
    {
      title: "C#",
      id: "group-tab-one",
      content: "```shell\ntab: 正文 ^not-a-tab\n```",
    },
    {
      title: "x^2",
      content: "正文",
    },
    {
      title: "标签3",
      id: "group-tab-empty",
      content: "",
    },
  ]);
  assert.deepEqual(parseTabs(serializeTabs(tabs)), tabs);
});

test("首次引用写回前再次核对内容，拒绝读盘后的并发修改", async () => {
  const { app, state } = fixture("````tab\n" + body + "\n````\n");
  app.vault.process = async (_file, update) => {
    state.text = state.text.replace("正文", "外部修改");
    state.text = update(state.text);
  };
  await assert.rejects(createTabReference(app, "笔记.md", 0, body, 1), /发生变化/);
  assert.ok(state.text.includes("外部修改"));
  assert.equal(state.text.includes("\n^"), false);
});

test("六位组 ID 与组内标签 ID 碰撞时重新生成", async () => {
  const { app, state } = fixture("段落 ^abcdef\n\n````tab\n" + body + "\n````\n");
  const original = crypto.randomUUID;
  let ids = ["abcdef", "123456", "654321"];
  crypto.randomUUID = () => ids.shift() + "00-0000-4000-8000-000000000000";
  try {
    const reference = await createTabReference(app, "笔记.md", 2, body, 0);
    assert.equal(reference.blockId, "123456");
    assert.equal(reference.tabId, "123456-654321");
    const next = reference.source.replace("123456-654321", "123456-aaaaaa");
    state.text = state.text.replace(reference.source, next);
    ids = ["aaaaaa", "bbbbbb"];
    const second = await createTabReference(app, "笔记.md", 2, next, 1);
    assert.equal(second.tabId, "123456-bbbbbb");
  } finally {
    crypto.randomUUID = original;
  }
});

test("没有路径的引用按原生缓存定位，缓存过期时回退查找，重复目标拒绝跳转", async () => {
  const a = {
    path: "旧.md",
    extension: "md",
    text: "```tab\ntab: A ^abc123-def456\n正文\n```\n^abc123",
  };
  const b = {
    path: "other.md",
    extension: "md",
    text: "普通段落",
  };
  const app = {
    vault: {
      getMarkdownFiles: () => [a, b],
      read: async (file) => file.text,
    },
    metadataCache: {
      getFileCache: (file) =>
        file === b
          ? {
              blocks: {
                abc123: {},
              },
            }
          : null,
    },
  };
  const match = await findReferencedTab(app, "abc123", "def456");
  assert.equal(match.file, a);
  assert.equal(match.index, 0);
  a.path = "新目录/已改名.md";
  assert.equal((await findReferencedTab(app, "abc123", "def456")).file.path, a.path);
  app.metadataCache.getFileCache = () => ({
    blocks: {
      abc123: {},
    },
  });
  b.text = a.text;
  await assert.rejects(findReferencedTab(app, "abc123", "def456"), /ID 重复/);
  b.text = "普通段落";
  a.text = "已删除";
  assert.equal(await findReferencedTab(app, "abc123", "def456"), null);
});

test("已有原生块 ID 原样复用，CRLF 与周围段落保留", async () => {
  const { app, state } = fixture(
    ("段落\n\n````tab\n" + body + "\n````\n^existing-block\n\n末段").replace(/\n/g, "\r\n"),
  );
  const reference = await createTabReference(app, "笔记.md", 2, body, 0);
  assert.equal(reference.blockId, "existing-block");
  assert.equal(/(?<!\r)\n/.test(state.text), false);
  assert.ok(state.text.endsWith("\r\n\r\n末段"));
});

test("改名、替换正文和排序保留 ID，删除后旧链接不指向同名页", async () => {
  const { app, state } = fixture("````tab\n" + body + "\n````\n");
  const reference = await createTabReference(app, "笔记.md", 0, body, 0);
  const parsed = parseTabs(reference.source);
  const changed = applyTabOperations(parsed, [
    {
      type: "replace-tab",
      index: 0,
      tab: {
        title: "新名",
        content: "新内容",
      },
    },
    {
      type: "move-tab",
      fromIndex: 0,
      toIndex: 1,
    },
  ]);
  assert.equal(changed.tabs[1].id, reference.tabId);
  const next = serializeTabs(changed.tabs);
  await updateMarkdownSource(app, "笔记.md", 0, reference.source, next);
  assert.equal(
    resolveReferencedTab(
      state.text,
      reference.blockId,
      reference.tabId.slice(reference.blockId.length + 1),
    ).index,
    1,
  );
  const removed = applyTabOperations(changed.tabs, [
    {
      type: "remove-tab",
      index: 1,
    },
  ]);
  await updateMarkdownSource(app, "笔记.md", 0, next, serializeTabs(removed.tabs));
  assert.equal(
    resolveReferencedTab(
      state.text,
      reference.blockId,
      reference.tabId.slice(reference.blockId.length + 1),
    ),
    null,
  );
});

test("生成引用前源码冲突拒绝写入，删除整个组同时移除原生锚点", async () => {
  const { app, state } = fixture("````tab\n" + body + "\n````\n");
  await assert.rejects(createTabReference(app, "笔记.md", 0, body + " changed", 0), /发生变化/);
  const reference = await createTabReference(app, "笔记.md", 0, body, 0);
  await updateMarkdownSource(app, "笔记.md", 0, reference.source, null);
  assert.equal(state.text.trim(), "");
});
