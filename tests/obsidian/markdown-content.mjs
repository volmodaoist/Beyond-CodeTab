import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchTestVault } from "./host.mjs";

const table = (await readFile(new URL("../fixtures/table.md", import.meta.url), "utf8")).trimEnd();
const wrap = (body) =>
  "````tab\ntab: 表格\n" + body + "\n\ntab: 对照\n```text\nuntouched\n```\n````\n";
const host = await launchTestVault(wrap(table));
const { page, directory, vault } = host;
const errors = [];
const reports = [];
page.on("pageerror", (error) => errors.push(error.message));
const group = page.getByTestId("code-tab-group").filter({
  visible: true,
});
const panel = group.getByTestId("code-tab-panel").filter({
  visible: true,
});
const editor = group.getByTestId("code-tab-editor");
const typeInput = group.getByTestId("code-tab-language");
const fileContent = () => readFile(join(vault, "Test.md"), "utf8");
const settle = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function show(body, mode = "preview", theme = "light") {
  await page.evaluate(
    async ({ markdown, mode, theme }) => {
      const file = app.vault.getAbstractFileByPath("Test.md");
      if ((await app.vault.read(file)) !== markdown) {
        const parsed = new Promise((resolve) => {
          const ref = app.metadataCache.on("changed", (changed, text) => {
            if (changed.path === file.path && text === markdown) {
              app.metadataCache.offref(ref);
              resolve();
            }
          });
        });
        await app.vault.modify(file, markdown);
        await parsed;
      }
      await app.workspace.getLeaf().setViewState({
        type: "empty",
      });
      app.plugins.plugins["obsidian-code-tab"].activeTabs.clear();
      document.body.removeClass("theme-light", "theme-dark");
      document.body.addClass("theme-" + theme);
      await app.workspace.getLeaf().setViewState({
        type: "markdown",
        state: {
          file: "Test.md",
          mode,
        },
      });
    },
    {
      markdown: wrap(body),
      mode,
      theme,
    },
  );
  await panel.waitFor();
  await settle();
}

async function tableSnapshot() {
  return panel.evaluate((panel) => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    };
    const table = panel.querySelector("table");
    return {
      panel: rect(panel),
      table: rect(table),
      cells: [...table.querySelectorAll("th,td")].map(rect),
    };
  });
}

function sameTable(before, after) {
  for (const [label, first, second] of [
    ["panel", before.panel, after.panel],
    ["table", before.table, after.table],
    ...before.cells.map((cell, index) => ["cell " + index, cell, after.cells[index]]),
  ]) {
    for (const dimension of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(first[dimension] - second[dimension]) < 1,
        `${label}.${dimension}: ${first[dimension]} -> ${second[dimension]}`,
      );
    }
  }
}

// 宿主编辑表格后会自动补齐列宽空格和分隔线长度；比较单元格内容，同时严格保留其余 Markdown。
function normalizeTableSpacing(markdown) {
  return markdown
    .split("\n")
    .map((line) =>
      line.startsWith("|")
        ? line
            .split("|")
            .map((cell) => cell.trim().replace(/^(:?)-+(:?)$/, "$1---$2"))
            .join("|")
        : line,
    )
    .join("\n");
}

async function waitForPreview() {
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".code-tab.is-editing")].some((el) => el.checkVisibility()),
  );
  await settle();
}

try {
  for (const mode of ["preview", "source"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [1200, 800]) {
        const label = `${mode}-${theme}-${width}`;
        await page.setViewportSize({
          width,
          height: 1200,
        });
        await show(table, mode, theme);
        await panel.locator("table").waitFor();
        // 截取当前视口，不用 locator.screenshot 自动滚动长表格，避免干扰宿主编辑器的滚动位置。
        await page.screenshot({
          path: join(directory, label + "-preview.png"),
        });
        const before = await tableSnapshot();
        await panel.locator("th").first().click();
        await editor.waitFor();
        const cell = editor.locator("th .cm-content").first();
        await cell.waitFor();
        await settle();
        sameTable(before, await tableSnapshot());
        assert.equal(await typeInput.inputValue(), "markdown");
        await page.screenshot({
          path: join(directory, label + "-editing.png"),
        });
        await cell.fill("标识更新");
        await cell.press("Meta+Enter");
        await waitForPreview();
        const saved = await fileContent();
        assert.equal(
          normalizeTableSpacing(saved),
          normalizeTableSpacing(wrap(table.replace("标识 |", "标识更新 |"))),
          "单元格修改必须写回且保留另一标签",
        );
        await panel.locator("th").first().click();
        await cell.fill("取消这次修改");
        await cell.press("Escape");
        await waitForPreview();
        assert.equal(await fileContent(), saved, "取消不应改变已保存的任何内容或格式");
        reports.push({
          mode,
          theme,
          width,
          result: "passed",
        });
        console.log("PASS Markdown table", label);
      }
    }
  }

  await page.setViewportSize({
    width: 1200,
    height: 1000,
  });
  await show(table);
  await panel.locator("th").first().click();
  await editor.locator("th .cm-content").first().waitFor();
  const shortTable = await tableSnapshot();
  await editor.locator(".table-row-btn").click();
  assert.equal(await editor.locator("tbody tr").count(), 6, "原生添加行按钮应保持可用");
  await editor.locator("tbody tr").last().locator("td").first().click();
  const newCell = editor.locator("tbody tr").last().locator(".cm-content");
  await newCell.fill("新增项");
  await settle();
  assert.ok(
    (await tableSnapshot()).panel.height > shortTable.panel.height + 20,
    "增加行后表格自然增高",
  );
  await newCell.press("Meta+Enter");
  await waitForPreview();
  assert.equal(await panel.locator("tbody tr").count(), 6);
  assert.equal(await panel.locator("tbody tr").last().locator("td").first().innerText(), "新增项");
  assert.ok((await fileContent()).includes("untouched"));

  const mixed = "表格前段落\n\n" + table + "\n\n表格后段落";
  await show(mixed);
  await panel.locator("th").first().click();
  await editor.locator("th").first().click();
  const mixedCell = editor.locator("th .cm-content").first();
  await mixedCell.fill("混合内容更新");
  await mixedCell.press("Meta+Enter");
  await waitForPreview();
  assert.equal(
    normalizeTableSpacing(await fileContent()),
    normalizeTableSpacing(wrap(mixed.replace("标识 |", "混合内容更新 |"))),
    "表格前后的段落不能被隐藏或丢失",
  );
  console.log("PASS table growth and surrounding Markdown");

  const listAfterCode = "```c++\nint value = 3;\n```\n\nHello\n\n- ";
  await show(listAfterCode);
  await panel.locator("pre").click();
  await editor.waitFor();
  await settle();
  const listAlignment = await editor.evaluate((editor) => {
    const paragraph = [...editor.querySelectorAll(".cm-line")].find(
      (line) => line.textContent === "Hello",
    );
    const list = editor.querySelector(".cm-line.HyperMD-list-line");
    const bullet = list.querySelector(".list-bullet");
    return {
      paragraphStart: paragraph.getBoundingClientRect().left,
      markerStart: bullet.getBoundingClientRect().left,
    };
  });
  assert.ok(
    Math.abs(listAlignment.markerStart - listAlignment.paragraphStart) < 6,
    `列表圆点应与普通段落左边缘对齐: ${JSON.stringify(listAlignment)}`,
  );
  await page.keyboard.press("Escape");
  await waitForPreview();
  const previewListAlignment = await panel.evaluate((panel) => {
    const paragraph = panel.querySelector("p");
    const item = panel.querySelector("li");
    return {
      paragraphStart: paragraph.getBoundingClientRect().left,
      itemStart: item.getBoundingClientRect().left,
      fontSize: Number.parseFloat(getComputedStyle(item).fontSize),
    };
  });
  assert.ok(
    Math.abs(
      previewListAlignment.itemStart -
        previewListAlignment.paragraphStart -
        previewListAlignment.fontSize,
    ) < 1,
    `预览列表只应保留一格正文缩进: ${JSON.stringify(previewListAlignment)}`,
  );
  console.log("PASS list alignment after code block");

  await show("```md\n" + table + "\n```");
  await panel.locator("table").waitFor();
  await panel.locator("th").first().click();
  await editor.waitFor();
  assert.equal(
    normalizeTableSpacing(await page.evaluate(() => window.codeTabTestEmbed.editor.getValue())),
    normalizeTableSpacing(table),
  );
  await typeInput.press("Escape");
  await waitForPreview();

  // 从 text 改为 markdown 后直接显示表格；再改回 text 时得到完整代码围栏。
  await show("```text\n" + table + "\n```");
  await panel.locator("pre").click();
  await settle();
  await typeInput.fill("markdown");
  await typeInput.press("Meta+Enter");
  await waitForPreview();
  await panel.locator("table").waitFor();
  assert.equal(await fileContent(), wrap(table));
  await panel.locator("th").first().click();
  await typeInput.fill("text");
  await typeInput.press("Meta+Enter");
  await waitForPreview();
  assert.equal(
    normalizeTableSpacing(await panel.locator("pre code").innerText()),
    normalizeTableSpacing(table + "\n"),
  );

  // 用真实的宿主注册接口验证开放类型，不把第三方处理器误当成 Prism 语言。
  await page.evaluate(() => {
    window.demoRendererCalls = [];
    app.plugins.plugins["obsidian-code-tab"].registerMarkdownCodeBlockProcessor(
      "demo-renderer",
      (source, element) => {
        window.demoRendererCalls.push(source);
        element.setAttribute("data-demo-renderer", "");
        element.textContent = "自定义渲染：" + source.trim();
      },
    );
  });
  await show("```text\nexample\n```");
  await panel.locator("pre").click();
  await settle();
  await typeInput.fill("demo-renderer");
  await editor.locator(".cm-content").focus();
  assert.deepEqual(
    await page.evaluate(() => window.demoRendererCalls),
    [],
    "修改类型时不能拿空文档提前调用插件",
  );
  await page.keyboard.press("Meta+Enter");
  await waitForPreview();
  assert.equal(await panel.locator("[data-demo-renderer]").innerText(), "自定义渲染：example");
  console.log("PASS Markdown conversion and custom renderer");

  // 普通嵌入点击由宿主处理；不会把预览替换成链接源码编辑器。
  await page.evaluate(async () => {
    await app.vault.create(
      "diagram.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#a5d8ff"/></svg>',
    );
  });
  await show("![[diagram.svg]]");
  await panel.locator(".internal-embed img").waitFor();
  await panel.locator(".internal-embed img").click();
  assert.equal(await editor.count(), 0);
  assert.equal(await fileContent(), wrap("![[diagram.svg]]"));
  // 宿主可能打开图片放大层，关闭后继续后续测试。
  await page.keyboard.press("Escape");
  console.log("PASS native embed interaction");

  // 可选：使用本机已有的 Excalidraw 插件，在临时仓库中验证真实画布嵌入。
  // 不复制插件的用户设置，不修改日常仓库，也不在源码中写死个人安装路径。
  const excalidraw = process.env.CODE_TAB_EXCALIDRAW_PLUGIN;
  if (excalidraw) {
    const destination = join(vault, ".obsidian/plugins/obsidian-excalidraw-plugin");
    await mkdir(destination, {
      recursive: true,
    });
    for (const name of ["main.js", "manifest.json", "styles.css"]) {
      await copyFile(join(excalidraw, name), join(destination, name));
    }
    // 只为测试仓库关闭首次安装的欢迎页，避免异步弹窗遮挡画布；不复制用户设置。
    await writeFile(
      join(destination, "data.json"),
      JSON.stringify({
        showReleaseNotes: false,
      }),
    );
    await page.evaluate(async () => {
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin("obsidian-excalidraw-plugin");
      const drawing = {
        type: "excalidraw",
        version: 2,
        source: "code-tab-test",
        elements: [
          {
            id: "rectangle",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 320,
            height: 120,
            angle: 0,
            strokeColor: "#1e1e1e",
            backgroundColor: "#a5d8ff",
            fillStyle: "solid",
            strokeWidth: 2,
            strokeStyle: "solid",
            roughness: 0,
            opacity: 100,
            groupIds: [],
            frameId: null,
            roundness: null,
            seed: 1,
            version: 1,
            versionNonce: 1,
            isDeleted: false,
            boundElements: null,
            updated: 1,
            link: null,
            locked: false,
          },
        ],
        appState: {
          viewBackgroundColor: "#ffffff",
        },
        files: {},
      };
      await app.vault.create(
        "Drawing.excalidraw.md",
        "---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n## Text Elements\n%%\n## Drawing\n```json\n" +
          JSON.stringify(drawing) +
          "\n```\n%%",
      );
    });
    await show("![[Drawing.excalidraw.md]]");
    const excalidrawEmbed = panel.locator(".excalidraw-svg, .excalidraw-embedded-img").first();
    await excalidrawEmbed.waitFor({
      timeout: 30000,
    });
    const assertExcalidrawFillsPanel = async (label) => {
      const widths = await panel.evaluate((element) => {
        const drawing = element.querySelector(".excalidraw-svg, .excalidraw-embedded-img");
        return {
          panel: element.clientWidth,
          drawing: drawing?.getBoundingClientRect().width ?? 0,
        };
      });
      assert.ok(
        widths.drawing >= widths.panel * 0.9,
        `${label} 应铺满面板：${widths.drawing} / ${widths.panel}`,
      );
    };
    await assertExcalidrawFillsPanel("单画板");
    await group.screenshot({
      path: join(directory, "excalidraw-embed.png"),
    });
    await excalidrawEmbed.click();
    assert.equal(await editor.count(), 0);
    assert.equal(await fileContent(), wrap("![[Drawing.excalidraw.md]]"));
    console.log("PASS real Excalidraw embed");

    await show("画板说明\n\n![[Drawing.excalidraw.md]]");
    await panel.locator(".excalidraw-svg, .excalidraw-embedded-img").first().waitFor({
      timeout: 30000,
    });
    assert.equal(await panel.getByTestId("code-tab-frame-deck").count(), 0);
    await assertExcalidrawFillsPanel("复合 Markdown 中的画板");
    console.log("PASS composite Markdown Excalidraw width");

    const frameDeckFixture = await readFile(
      new URL("../fixtures/Frame-Deck-三阶段架构演进.excalidraw.md", import.meta.url),
      "utf8",
    );
    await page.evaluate(async (drawing) => {
      await app.vault.create("Deck.excalidraw.md", drawing);
    }, frameDeckFixture);
    await show("![[Deck.excalidraw.md]]");
    const deck = panel.getByTestId("code-tab-frame-deck");
    await deck.waitFor({
      timeout: 30000,
    });
    const counter = deck.locator(".code-tab__frame-counter");
    await counter
      .filter({
        hasText: "1 / 3",
      })
      .waitFor({
        timeout: 30000,
      });
    const previous = deck.getByRole("button", {
      name: "上一页",
    });
    const next = deck.getByRole("button", {
      name: "下一页",
    });
    assert.equal(await counter.innerText(), "1 / 3");
    assert.equal(await previous.isEnabled(), true);
    assert.equal(await next.isEnabled(), true);
    await previous.click();
    await counter
      .filter({
        hasText: "3 / 3",
      })
      .waitFor();
    await next.click();
    await counter
      .filter({
        hasText: "1 / 3",
      })
      .waitFor();
    await next.click();
    await counter
      .filter({
        hasText: "2 / 3",
      })
      .waitFor();
    assert.equal(await previous.isEnabled(), true);
    assert.equal(await next.isEnabled(), true);
    assert.equal(await editor.count(), 0, "翻页按钮不能进入源码编辑态");
    assert.deepEqual(
      await page.evaluate(() => [
        ...app.plugins.plugins["obsidian-code-tab"].activeFrames.values(),
      ]),
      ["frame-2"],
    );
    await next.click();
    await counter
      .filter({
        hasText: "3 / 3",
      })
      .waitFor();
    assert.equal(await next.isEnabled(), true);
    await next.click();
    await counter
      .filter({
        hasText: "1 / 3",
      })
      .waitFor();
    await previous.click();
    await counter
      .filter({
        hasText: "3 / 3",
      })
      .waitFor();
    await group.screenshot({
      path: join(directory, "excalidraw-frame-deck.png"),
    });
    console.log("PASS Excalidraw Frame Deck navigation");
  } else {
    console.log("SKIP Excalidraw: set CODE_TAB_EXCALIDRAW_PLUGIN to its local plugin directory");
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, "report.json"), JSON.stringify(reports, null, 2));
  console.log("Artifacts:", directory);
} catch (error) {
  await page
    .screenshot({
      path: join(directory, "failure.png"),
    })
    .catch(() => {});
  console.error("Failure artifacts:", directory);
  throw error;
} finally {
  await host.close();
}
