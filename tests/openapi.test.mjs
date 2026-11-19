import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  stdin: {
    contents: 'export * from "./api"; export * from "./operations"; export * from "./errors";',
    resolveDir: fileURLToPath(new URL("../src/openapi/", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createCodeTabApi, applyTabOperations, CodeTabErrorCode } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
);

const tabs = [
  {
    title: "同名",
    content: "first",
  },
  {
    title: "同名",
    content: "second",
  },
  {
    title: "尾页",
    content: "third",
  },
];

test("批量操作顺序应用，跟随选中页并保留原始数据", () => {
  const result = applyTabOperations(
    tabs,
    [
      {
        type: "insert-tab",
        index: 0,
        tab: {
          title: "新增",
          content: "new",
        },
      },
      {
        type: "move-tab",
        fromIndex: 2,
        toIndex: 0,
      },
      {
        type: "replace-tab",
        index: 0,
        tab: {
          title: "修改",
          content: "second",
        },
      },
      {
        type: "remove-tab",
        index: 3,
      },
    ],
    1,
  );
  assert.deepEqual(
    result.tabs.map((tab) => tab.title),
    ["修改", "新增", "同名"],
  );
  assert.equal(result.activeIndex, 0);
  assert.deepEqual(
    tabs.map((tab) => tab.content),
    ["first", "second", "third"],
  );
});

test("无效的批量操作不污染原始数组", () => {
  assert.throws(
    () =>
      applyTabOperations(tabs, [
        {
          type: "remove-tab",
          index: 0,
        },
        {
          type: "move-tab",
          fromIndex: 20,
          toIndex: 0,
        },
      ]),
    {
      code: CodeTabErrorCode.InvalidOperation,
    },
  );
  assert.equal(tabs.length, 3);
});

test("最后一个标签删除后无选中项，空组可插入", () => {
  const removed = applyTabOperations(tabs.slice(0, 1), [
    {
      type: "remove-tab",
      index: 0,
    },
  ]);
  assert.equal(removed.activeIndex, -1);
  const inserted = applyTabOperations(
    [],
    [
      {
        type: "insert-tab",
        index: 0,
        tab: tabs[0],
      },
    ],
    -1,
  );
  assert.equal(inserted.activeIndex, 0);
});

test("操作索引和标题校验覆盖 NaN、换行及未知操作", () => {
  for (const operations of [
    [
      {
        type: "remove-tab",
        index: NaN,
      },
    ],
    [
      {
        type: "replace-tab",
        index: 0,
        tab: {
          title: "\n",
          content: "",
        },
      },
    ],
    [
      {
        type: "unknown",
      },
    ],
  ]) {
    assert.throws(() => applyTabOperations(tabs, operations), {
      code: CodeTabErrorCode.InvalidOperation,
    });
  }
});

test("公开解析与序列化保留嵌套代码块，并返回隔离的快照", () => {
  const api = createCodeTabApi(async () => {
    throw new Error("render not requested");
  }, {});
  const source = "tab: Python\n```python\nprint('tab: kept')\n```\n\ntab: 文档\n正文";
  const parsed = api.parse(source);
  assert.equal(parsed.length, 2);
  assert.ok(Object.isFrozen(parsed[0]));
  assert.equal(api.serialize(parsed), source);
  assert.equal(api.errorCodes.Busy, CodeTabErrorCode.Busy);
  assert.throws(() => api.parse(null), {
    code: CodeTabErrorCode.InvalidOptions,
  });
});
