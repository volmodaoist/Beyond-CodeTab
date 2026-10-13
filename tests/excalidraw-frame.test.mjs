import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/components/MultiTab/excalidrawFrame.ts", import.meta.url)),
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { buildExcalidrawFrameEmbed, parseSingleExcalidrawEmbed, sortExcalidrawFrames } =
  await import(
    "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
  );

function frame(id, options = {}) {
  return {
    id,
    type: "frame",
    x: options.x ?? 0,
    y: options.y ?? 0,
    name: options.name,
    isDeleted: options.isDeleted,
    customData:
      options.order === undefined
        ? undefined
        : {
            slideshow: {
              order: options.order,
            },
          },
  };
}

test("只识别没有子区域的单一 Excalidraw 嵌入", () => {
  assert.deepEqual(parseSingleExcalidrawEmbed("  ![[架构.excalidraw.md]]\n"), {
    linkPath: "架构.excalidraw.md",
    suffix: "",
  });
  assert.deepEqual(parseSingleExcalidrawEmbed("![[架构.excalidraw|900x600]]"), {
    linkPath: "架构.excalidraw",
    suffix: "|900x600",
  });
  assert.equal(parseSingleExcalidrawEmbed("说明\n![[架构.excalidraw.md]]"), null);
  assert.equal(parseSingleExcalidrawEmbed("![[架构.excalidraw.md]]\n正文"), null);
  assert.equal(parseSingleExcalidrawEmbed("![[架构.excalidraw.md#^frame=abc]]"), null);
});

test("Frame 顺序优先显式 order，再使用自然名称", () => {
  const frames = sortExcalidrawFrames([
    frame("name-10", {
      name: "第 10 页",
    }),
    frame("ordered-2", {
      name: "尾页",
      order: 2,
    }),
    frame("name-2", {
      name: "第 2 页",
    }),
    frame("ordered-1", {
      name: "首页",
      order: 1,
    }),
  ]);
  assert.deepEqual(
    frames.map((item) => item.id),
    ["ordered-1", "ordered-2", "name-2", "name-10"],
  );
});

test("同名和无名 Frame 按位置与 ID 稳定排序，并排除无效元素", () => {
  const frames = sortExcalidrawFrames([
    frame("b", {
      x: 20,
      y: 10,
    }),
    frame("deleted", {
      isDeleted: true,
    }),
    {
      ...frame("shape"),
      type: "rectangle",
    },
    frame("c", {
      x: 10,
      y: 20,
    }),
    frame("a", {
      x: 20,
      y: 10,
    }),
  ]);
  assert.deepEqual(
    frames.map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("Frame fragment 保留原嵌入的别名或尺寸", () => {
  const embed = parseSingleExcalidrawEmbed("![[架构.excalidraw.md|900x600]]");
  assert.ok(embed);
  assert.equal(
    buildExcalidrawFrameEmbed(embed, "frame-id"),
    "![[架构.excalidraw.md#^frame=frame-id|900x600]]",
  );
});
