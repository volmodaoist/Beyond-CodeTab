import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchTestVault } from "./host.mjs";

const python = "```python\nprint(1)\n```";
const javascript = "```js\nconst x = 1;\n```";
const initial =
  "# 引用测试\n\n````tab\ntab: 同名\n" +
  python +
  "\n\ntab: 同名\n" +
  javascript +
  "\n````\n\n普通段落 ^ordinary\n";
const host = await launchTestVault(initial);
const { page, directory, vault } = host;
const reports = [];
const errors = [];
let scenario = "启动";
page.on("pageerror", (error) =>
  errors.push({
    message: error.message,
    stack: error.stack,
    scenario,
  }),
);
async function check(name, action) {
  scenario = name;
  await action();
  reports.push({
    name,
    passed: true,
  });
}
const group = page
  .getByTestId("code-tab-group")
  .filter({
    visible: true,
  })
  .first();

try {
  await check("原生三引号补全、四引号同步、缩回三引号及撤销重做", async () => {
    await page.evaluate(async () => {
      await app.vault.create("Fence.md", "");
      await app.workspace.getLeaf().setViewState({
        type: "markdown",
        state: {
          file: "Fence.md",
          mode: "source",
        },
      });
      app.workspace.activeLeaf.view.editor.focus();
    });
    await page.keyboard.type("```");
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      "```\n```",
    );
    await page.keyboard.type("`");
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      "````\n````",
    );
    await page.keyboard.press("Backspace");
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      "```\n```",
    );
    await page.keyboard.press("Meta+z");
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      "````\n````",
    );
    await page.keyboard.press("Meta+Shift+z");
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      "```\n```",
    );
  });

  await page.evaluate(async () => {
    await app.workspace.getLeaf().setViewState({
      type: "markdown",
      state: {
        file: "Test.md",
        mode: "source",
      },
    });
    window.testClipboard = [];
    // 只替换剪贴板 I/O，编辑器、渲染器、写盘和协议处理器均使用真实宿主。
    window.require("electron").clipboard.writeText = (text) => {
      window.testClipboard.push(text);
    };
  });
  await group.waitFor();
  await check("源码按钮展开整个 tab 围栏，使用原生编辑器修改与撤销", async () => {
    await group.getByTestId("code-tab-edit").click();
    await page.waitForFunction(() => {
      const view = app.workspace.activeLeaf.view;
      const text = view.editor.cm.contentDOM.innerText;
      return (
        view.getMode() === "source" &&
        text.includes("````tab") &&
        text.includes("print(1)") &&
        text.includes("const x = 1;")
      );
    });
    assert.equal(await group.count(), 0);
    assert.equal(await readFile(join(vault, "Test.md"), "utf8"), initial);
    await page.evaluate(() => {
      app.workspace.activeLeaf.view.editor.replaceRange(
        "源码改名",
        {
          line: 3,
          ch: 5,
        },
        {
          line: 3,
          ch: 7,
        },
      );
    });
    await page.keyboard.press("Meta+s");
    await page.waitForFunction(async () =>
      (await app.vault.read(app.vault.getFileByPath("Test.md"))).includes("tab: 源码改名"),
    );
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Meta+s");
    await page.waitForFunction(
      async (initial) => (await app.vault.read(app.vault.getFileByPath("Test.md"))) === initial,
      initial,
    );
    await page.evaluate(() =>
      app.workspace.activeLeaf.view.editor.setCursor({
        line: 0,
        ch: 0,
      }),
    );
    await group.waitFor();
  });
  await check("复制包括代码语言与围栏，不触发编辑或写回", async () => {
    await group.getByTestId("code-tab-copy").click();
    assert.equal(await page.evaluate(() => window.testClipboard.at(-1)), python);
    assert.equal(await group.getByTestId("code-tab-editor").count(), 0);
    assert.equal(await readFile(join(vault, "Test.md"), "utf8"), initial);
  });

  await check("复制未保存草稿，源码和引用按钮保存失败时保留编辑", async () => {
    await group
      .getByTestId("code-tab-panel")
      .filter({
        visible: true,
      })
      .locator("pre")
      .click();
    await group.getByTestId("code-tab-editor").locator(".cm-content").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.insertText("print(2)");
    await group.getByTestId("code-tab-copy").click();
    assert.equal(
      await page.evaluate(() => window.testClipboard.at(-1)),
      "```python\nprint(2)\n```",
    );
    assert.equal(await group.getByTestId("code-tab-editor").count(), 1);
    assert.equal(await readFile(join(vault, "Test.md"), "utf8"), initial);
    const count = await page.evaluate(() => window.testClipboard.length);
    await page.evaluate(() => {
      window.originalReferenceProcess = app.vault.process;
      window.referenceSaveFailed = false;
      app.vault.process = async () => {
        window.referenceSaveFailed = true;
        throw new Error("test: reference save failure");
      };
    });
    try {
      for (const control of ["code-tab-edit", "code-tab-reference"]) {
        await page.evaluate(() => {
          window.referenceSaveFailed = false;
        });
        await group.getByTestId(control).click();
        await page.waitForFunction(
          () =>
            window.referenceSaveFailed &&
            [...app.plugins.plugins["obsidian-code-tab"].referenceTargets.values()]
              .flatMap((targets) => [...targets])
              .some((target) => target.getSnapshot().editing && !target.getSnapshot().saving),
        );
        assert.equal(await page.evaluate(() => window.testClipboard.length), count);
        assert.equal(await group.getByTestId("code-tab-editor").count(), 1);
        assert.equal(await readFile(join(vault, "Test.md"), "utf8"), initial);
      }
    } finally {
      await page.evaluate(() => {
        app.vault.process = window.originalReferenceProcess;
      });
    }
    await group.getByTestId("code-tab-editor").locator(".cm-content").focus();
    await page.keyboard.press("Escape");
    await group.getByTestId("code-tab-editor").waitFor({
      state: "detached",
    });
  });

  let params;
  await check("同名第二页建立稳定引用，原生块 ID 被 Obsidian 登记", async () => {
    await group.getByTestId("code-tab-tab").nth(1).click();
    await group.getByTestId("code-tab-reference").click();
    await page.waitForFunction(() =>
      window.testClipboard.at(-1)?.includes("obsidian://beyond-code-tab?"),
    );
    const link = await page.evaluate(() => window.testClipboard.at(-1));
    const uri = new URL(link.slice(link.indexOf("(") + 1, -1));
    params = Object.fromEntries(uri.searchParams);
    assert.match(params.block, /^[0-9a-f]{6}$/);
    assert.match(params.tab, /^[0-9a-f]{6}$/);
    assert.deepEqual(Object.keys(params).sort(), ["block", "tab"]);
    await page.waitForFunction(
      (id) =>
        !!app.metadataCache.getFileCache(app.vault.getAbstractFileByPath("Test.md"))?.blocks?.[id],
      params.block,
    );
    assert.equal(await group.getByTestId("code-tab-tab").nth(1).textContent(), "同名");
    await group.getByTestId("code-tab-copy").click();
    assert.equal(await page.evaluate(() => window.testClipboard.at(-1)), javascript);
  });

  await check("专用协议选中指定页，原生普通块引用继续工作", async () => {
    await group.getByTestId("code-tab-tab").first().click();
    const mode = await page.evaluate(() => {
      window.referenceView = app.workspace.activeLeaf.view;
      return {
        mode: window.referenceView.getMode(),
        source: window.referenceView.getState().source,
      };
    });
    await page.evaluate(async (params) => {
      await app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params);
    }, params);
    await group
      .getByTestId("code-tab-panel")
      .filter({
        visible: true,
        hasText: "const x",
      })
      .waitFor();
    assert.equal(
      await group.getByTestId("code-tab-tab").nth(1).getAttribute("aria-selected"),
      "true",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        mode: app.workspace.activeLeaf.view.getMode(),
        source: app.workspace.activeLeaf.view.getState().source,
      })),
      mode,
    );
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view === window.referenceView),
      true,
    );
    await page.evaluate(async () => app.workspace.openLinkText("Test.md#^ordinary", "", false));
    assert.ok(
      await page.evaluate(
        () =>
          !!app.metadataCache.getFileCache(app.vault.getAbstractFileByPath("Test.md")).blocks
            .ordinary,
      ),
    );
  });

  for (const [name, mode, source] of [
    ["阅读", "preview", false],
    ["实时预览", "source", false],
    ["源码", "source", true],
  ]) {
    await check("引用跳转保留" + name + "模式", async () => {
      await page.evaluate(
        async ({ mode, source }) =>
          app.workspace.getLeaf().setViewState({
            type: "markdown",
            state: {
              file: "Test.md",
              mode,
              source,
            },
          }),
        {
          mode,
          source,
        },
      );
      await page.evaluate(() => {
        window.referenceView = app.workspace.activeLeaf.view;
      });
      const before = await readFile(join(vault, "Test.md"), "utf8");
      await page.evaluate(
        async (params) => app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params),
        params,
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          mode: app.workspace.activeLeaf.view.getMode(),
          source: app.workspace.activeLeaf.view.getState().source,
        })),
        {
          mode,
          source,
        },
      );
      assert.equal(
        await page.evaluate(() => app.workspace.activeLeaf.view === window.referenceView),
        true,
      );
      if (!source) {
        await group
          .getByTestId("code-tab-panel")
          .filter({
            visible: true,
            hasText: "const x",
          })
          .waitFor();
        assert.equal(
          await group.getByTestId("code-tab-tab").nth(1).getAttribute("aria-selected"),
          "true",
        );
        if (mode === "source") {
          assert.equal(
            await page.evaluate(() =>
              app.workspace.activeLeaf.view.editor.cm.contentDOM.innerText.includes("````tab"),
            ),
            false,
          );
        }
      } else {
        assert.equal(await group.count(), 0);
        assert.ok(
          await page.evaluate(() =>
            app.workspace.activeLeaf.view.editor.cm.contentDOM.innerText.includes("````tab"),
          ),
        );
      }
      assert.equal(await readFile(join(vault, "Test.md"), "utf8"), before);
    });
  }
  await page.evaluate(async () =>
    app.workspace.getLeaf().setViewState({
      type: "markdown",
      state: {
        file: "Test.md",
        mode: "preview",
        source: false,
      },
    }),
  );
  await group.waitFor();

  await check("文首 tab 块在实时预览中跳转后继续显示标签组件", async () => {
    await page.evaluate(async () => {
      await app.vault.create(
        "First.md",
        "```tab\ntab: A ^112233-445566\n正文 A\n\ntab: B ^112233-778899\n正文 B\n```\n^112233\n",
      );
      await app.workspace.getLeaf().setViewState({
        type: "markdown",
        state: {
          file: "First.md",
          mode: "source",
          source: false,
        },
      });
      await app.workspace.protocolHandler.handlers.get("beyond-code-tab")({
        block: "112233",
        tab: "778899",
      });
    });
    await group
      .getByTestId("code-tab-tab")
      .nth(1)
      .filter({
        hasText: "B",
      })
      .waitFor();
    assert.equal(
      await group.getByTestId("code-tab-tab").nth(1).getAttribute("aria-selected"),
      "true",
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        mode: app.workspace.activeLeaf.view.getMode(),
        source: app.workspace.activeLeaf.view.getState().source,
      })),
      {
        mode: "source",
        source: false,
      },
    );
    assert.equal(
      await page.evaluate(() =>
        app.workspace.activeLeaf.view.editor.cm.contentDOM.innerText.includes("```tab"),
      ),
      false,
    );
    await page.evaluate(async () =>
      app.workspace.getLeaf().setViewState({
        type: "markdown",
        state: {
          file: "Test.md",
          mode: "preview",
          source: false,
        },
      }),
    );
    await group.waitFor();
  });

  for (const [name, targetMode, originMode] of [
    ["阅读", "preview", "source"],
    ["实时预览", "source", "preview"],
  ]) {
    await check("从其他标签页跳转保留目标的" + name + "模式", async () => {
      await page.evaluate(
        async ({ targetMode, originMode }) => {
          await app.workspace.getLeaf().setViewState({
            type: "markdown",
            state: {
              file: "Test.md",
              mode: targetMode,
              source: false,
            },
          });
          window.referenceLeaf = app.workspace.activeLeaf;
          window.referenceView = window.referenceLeaf.view;
          if (!app.vault.getFileByPath("ModeLinks.md")) {
            await app.vault.create("ModeLinks.md", "# 模式测试\n\n跳转到目标笔记\n");
            window.referenceOriginLeaf = app.workspace.getLeaf("tab");
          }
          await window.referenceOriginLeaf.setViewState({
            type: "markdown",
            active: true,
            state: {
              file: "ModeLinks.md",
              mode: originMode,
              source: false,
            },
          });
        },
        {
          targetMode,
          originMode,
        },
      );
      assert.equal(
        await page.evaluate(() => app.workspace.activeLeaf.view.file.path),
        "ModeLinks.md",
      );
      await page.evaluate(
        async (params) => app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params),
        params,
      );
      await group
        .getByTestId("code-tab-panel")
        .filter({
          visible: true,
          hasText: "const x",
        })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            app.workspace.activeLeaf === window.referenceLeaf &&
            app.workspace.activeLeaf.view === window.referenceView,
        ),
        true,
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          mode: app.workspace.activeLeaf.view.getMode(),
          source: app.workspace.activeLeaf.view.getState().source,
        })),
        {
          mode: targetMode,
          source: false,
        },
      );
    });
  }

  await check("重复生成引用复用 ID 且不写回文件", async () => {
    const before = await readFile(join(vault, "Test.md"), "utf8");
    const count = await page.evaluate(() => window.testClipboard.length);
    await page.evaluate(() => {
      window.referenceWriteCount = 0;
      window.originalReferenceProcess = app.vault.process;
      app.vault.process = function (...args) {
        window.referenceWriteCount++;
        return window.originalReferenceProcess.apply(this, args);
      };
    });
    try {
      await group.getByTestId("code-tab-reference").click();
      await page.waitForFunction((count) => window.testClipboard.length > count, count);
      const link = await page.evaluate(() => window.testClipboard.at(-1));
      const uri = new URL(link.slice(link.indexOf("(") + 1, -1));
      assert.deepEqual(Object.fromEntries(uri.searchParams), params);
      assert.equal(await page.evaluate(() => window.referenceWriteCount), 0);
      assert.equal(await readFile(join(vault, "Test.md"), "utf8"), before);
    } finally {
      await page.evaluate(() => {
        app.vault.process = window.originalReferenceProcess;
      });
    }
  });

  await check("点击引用保存当前草稿并保留已有稳定 ID", async () => {
    await group
      .getByTestId("code-tab-panel")
      .filter({
        visible: true,
      })
      .locator("pre")
      .click();
    await group.getByTestId("code-tab-editor").locator(".cm-content").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.insertText("const x = 2;");
    const count = await page.evaluate(() => window.testClipboard.length);
    await group.getByTestId("code-tab-reference").click();
    await page.waitForFunction((count) => window.testClipboard.length > count, count);
    await group.getByTestId("code-tab-editor").waitFor({
      state: "detached",
    });
    const link = await page.evaluate(() => window.testClipboard.at(-1));
    const uri = new URL(link.slice(link.indexOf("(") + 1, -1));
    assert.deepEqual(Object.fromEntries(uri.searchParams), params);
    assert.ok((await readFile(join(vault, "Test.md"), "utf8")).includes("const x = 2;"));
  });

  await check("改名和排序之后，旧引用仍定位同一页", async () => {
    await group.getByTestId("code-tab-tab").nth(1).dblclick();
    await group.getByTestId("code-tab-rename").fill("已改名");
    await group.getByTestId("code-tab-rename").press("Enter");
    await group.getByTestId("code-tab-rename").waitFor({
      state: "detached",
    });
    await page.waitForFunction(() => {
      const file = app.vault.getAbstractFileByPath("Test.md");
      return app.metadataCache.getFileCache(file)?.sections?.length > 0;
    });
    const source = group.getByTestId("code-tab-tab").nth(1);
    const target = group.getByTestId("code-tab-tab").first();
    await source.dragTo(target, {
      targetPosition: {
        x: 4,
        y: 14,
      },
    });
    await page.waitForFunction(async () => {
      const file = app.vault.getAbstractFileByPath("Test.md");
      const text = await app.vault.read(file);
      return text.indexOf("tab: 已改名") < text.indexOf("tab: 同名");
    });
    await page.waitForFunction(
      (id) =>
        app.metadataCache.getFileCache(app.vault.getAbstractFileByPath("Test.md"))?.blocks?.[id],
      params.block,
    );
    await group.getByTestId("code-tab-tab").nth(1).click();
    await page.evaluate(
      async (params) => app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params),
      params,
    );
    await group
      .getByTestId("code-tab-tab")
      .first()
      .filter({
        hasText: "已改名",
      })
      .waitFor();
    assert.equal(
      await group.getByTestId("code-tab-tab").first().getAttribute("aria-selected"),
      "true",
    );
  });

  await check("阅读视图源码按钮打开完整围栏，标题行ID和原生组ID保持", async () => {
    await page.evaluate(async () =>
      app.workspace.getLeaf().setViewState({
        type: "markdown",
        state: {
          file: "Test.md",
          mode: "preview",
          source: false,
        },
      }),
    );
    await group.waitFor();
    const before = await readFile(join(vault, "Test.md"), "utf8");
    assert.ok(before.includes("tab: 已改名 ^" + params.block + "-" + params.tab));
    assert.equal(before.includes("<!-- beyond-code-tab:"), false);
    await group.getByTestId("code-tab-edit").click();
    await page.waitForFunction((params) => {
      const view = app.workspace.activeLeaf.view;
      const text = view.editor.cm.contentDOM.innerText;
      return (
        view.getMode() === "source" &&
        text.includes("````tab") &&
        text.includes("tab: 已改名 ^" + params.block + "-" + params.tab) &&
        text.includes("tab: 同名")
      );
    }, params);
    assert.equal(await group.count(), 0);
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
      before,
    );
    assert.ok(before.includes("\n^" + params.block));
    await page.evaluate(async () =>
      app.workspace.getLeaf().setViewState({
        type: "markdown",
        state: {
          file: "Test.md",
          mode: "preview",
        },
      }),
    );
    await group.waitFor();
  });

  await check("从另一篇笔记跳转并选中目标，编辑中的引用保护草稿", async () => {
    await page.evaluate(async (params) => {
      await app.vault.create(
        "Links.md",
        "# 跨笔记引用\n\n[目标](obsidian://beyond-code-tab?" +
          new URLSearchParams(params) +
          ")\n\n[[Test#^" +
          params.block +
          "]]\n\n![[Test#^" +
          params.block +
          "]]\n",
      );
      await app.workspace.openLinkText("Links.md", "", false);
    }, params);
    assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file.path), "Links.md");
    await group.waitFor();
    assert.deepEqual(await group.getByTestId("code-tab-tab").allTextContents(), ["已改名", "同名"]);
    await page.evaluate(
      async (params) => app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params),
      params,
    );
    await group
      .getByTestId("code-tab-tab")
      .first()
      .filter({
        hasText: "已改名",
      })
      .waitFor();
    assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file.path), "Test.md");
    assert.equal(
      await group.getByTestId("code-tab-tab").first().getAttribute("aria-selected"),
      "true",
    );
    await group.getByTestId("code-tab-tab").nth(1).click();
    await group
      .getByTestId("code-tab-panel")
      .filter({
        visible: true,
      })
      .locator("pre")
      .click();
    await group.getByTestId("code-tab-editor").locator(".cm-content").focus();
    await page.keyboard.press("Meta+a");
    await page.keyboard.insertText("draft");
    const before = await readFile(join(vault, "Test.md"), "utf8");
    await page.evaluate(
      async (params) => app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params),
      params,
    );
    assert.equal(
      await group.getByTestId("code-tab-tab").nth(1).getAttribute("aria-selected"),
      "true",
    );
    assert.equal(await group.getByTestId("code-tab-editor").count(), 1);
    assert.equal(await readFile(join(vault, "Test.md"), "utf8"), before);
    await group.getByTestId("code-tab-editor").locator(".cm-content").focus();
    await page.keyboard.press("Escape");
    await group.getByTestId("code-tab-editor").waitFor({
      state: "detached",
    });
  });

  await check("笔记移动和改名后，原短引用继续定位对应标签", async () => {
    await page.evaluate(async () => {
      app.vault.setConfig("alwaysUpdateLinks", true);
      await app.vault.createFolder("Moved");
      await app.fileManager.renameFile(app.vault.getFileByPath("Test.md"), "Moved/Renamed.md");
      await app.workspace.openLinkText("Links.md", "", false);
    });
    await page.evaluate(
      async (params) => app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params),
      params,
    );
    await group
      .getByTestId("code-tab-tab")
      .first()
      .filter({
        hasText: "已改名",
      })
      .waitFor();
    assert.equal(
      await page.evaluate(() => app.workspace.activeLeaf.view.file.path),
      "Moved/Renamed.md",
    );
    assert.equal(
      await group.getByTestId("code-tab-tab").first().getAttribute("aria-selected"),
      "true",
    );
  });

  await check("删除引用目标后不跳转到另一个同名标签", async () => {
    await group.getByTestId("code-tab-tab").first().click({
      button: "right",
    });
    await page
      .getByText("删除标签", {
        exact: true,
      })
      .first()
      .click();
    await page.getByTestId("code-tab-delete-confirm").click();
    await page.getByTestId("code-tab-delete-confirm").waitFor({
      state: "detached",
    });
    assert.equal(await group.getByTestId("code-tab-tab").count(), 1);
    await page.evaluate(async () => app.workspace.openLinkText("Links.md", "", false));
    await page.evaluate(
      async (params) => app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params),
      params,
    );

    assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file.path), "Links.md");
  });

  await page.screenshot({
    path: join(directory, "toolbar-reference.png"),
  });
  assert.deepEqual(errors, []);
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(
      {
        reports,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Fence, toolbar and reference: " + reports.length + " scenarios passed");
  console.log("Artifacts: " + directory);
} catch (error) {
  const state = await page
    .evaluate(() => ({
      file: app.workspace.activeLeaf?.view?.file?.path,
      notices: [...document.querySelectorAll(".notice")].map((notice) => notice.textContent),
      groups: [...app.plugins.plugins["obsidian-code-tab"].referenceTargets.entries()].map(
        ([key, targets]) => ({
          key,
          snapshots: [...targets].map((target) => target.getSnapshot()),
        }),
      ),
    }))
    .catch(() => null);
  await page
    .screenshot({
      path: join(directory, "failure.png"),
    })
    .catch(() => {});
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(
      {
        reports,
        errors,
        failure: String(error),
        state,
      },
      null,
      2,
    ),
  );
  console.error("Artifacts: " + directory);
  throw error;
} finally {
  await host.close();
}
