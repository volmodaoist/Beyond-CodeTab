import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchTestVault } from "./host.mjs";

const first =
  "````tab\ntab: 首页\n```python\nprint(1)\n```\n\ntab: 中间页\n保留的 Markdown\n\ntab: 尾页\n```text\nlast\n```\n````";
const other = "````tab\ntab: 另一组\n```text\nuntouched\n```\n````";
const initial = first + "\n\n" + other + "\n";
const host = await launchTestVault(initial);
const { page, directory, vault } = host;
const groups = page.getByTestId("code-tab-group").filter({
  visible: true,
});
const group = groups.first();
const panel = group.getByTestId("code-tab-panel").filter({
  visible: true,
});
const rename = group.getByTestId("code-tab-rename");
const dialog = page.getByTestId("code-tab-delete-dialog");
const errors = [];
const reports = [];
page.on("pageerror", (error) => errors.push(error.message));
const fileContent = () => readFile(join(vault, "Test.md"), "utf8");
const settle = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

async function reset(mode = "preview", theme = "light") {
  await page.evaluate(
    async ({ initial, mode, theme }) => {
      const file = app.vault.getAbstractFileByPath("Test.md");
      if ((await app.vault.read(file)) !== initial) {
        const parsed = new Promise((resolve) => {
          const ref = app.metadataCache.on("changed", (changed, text) => {
            if (changed.path === file.path && text === initial) {
              app.metadataCache.offref(ref);
              resolve();
            }
          });
        });
        await app.vault.modify(file, initial);
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
      initial,
      mode,
      theme,
    },
  );
  await group
    .getByRole("tab", {
      name: "首页",
      exact: true,
    })
    .waitFor();
  await settle();
}

async function startRename(name) {
  await group
    .getByRole("tab", {
      name,
      exact: true,
    })
    .dblclick();
  await rename.waitFor();
}

async function expectTitle(name) {
  await rename.waitFor({
    state: "detached",
  });
  await group
    .getByRole("tab", {
      name,
      exact: true,
    })
    .waitFor();
  await settle();
}

async function requestDelete(name) {
  await group
    .getByRole("tab", {
      name,
      exact: true,
    })
    .click({
      button: "right",
    });
  await page
    .locator(".menu")
    .getByText("删除标签", {
      exact: true,
    })
    .click();
  await dialog.waitFor();
}

async function confirmDelete() {
  await dialog.getByTestId("code-tab-delete-confirm").click();
  await dialog.waitFor({
    state: "detached",
  });
  await settle();
}

try {
  await page.setViewportSize({
    width: 1100,
    height: 950,
  });
  for (const mode of ["preview", "source"]) {
    for (const theme of ["light", "dark"]) {
      await reset(mode, theme);
      const label = mode + "-" + theme;
      const title = "新标题 <b>✨";
      const before = await group.boundingBox();
      await startRename("首页");
      assert.ok(
        Math.abs((await group.boundingBox()).height - before.height) < 1,
        "标题输入不应撑高标签栏",
      );
      await rename.fill(title);
      await group.screenshot({
        path: join(directory, label + "-rename.png"),
      });
      await rename.press("Enter");
      await expectTitle(title);
      assert.equal(await fileContent(), initial.replace("tab: 首页", "tab: " + title));
      assert.equal(
        await group.locator(".code-tab__tab b").count(),
        0,
        "标题按文本显示，不能解释为 HTML",
      );

      // 空名称不写文件，Esc 取消；中文名称可在失去焦点时提交。
      const beforeCancel = await fileContent();
      await startRename("中间页");
      await rename.fill("   ");
      await rename.press("Enter");
      assert.equal(await rename.getAttribute("aria-invalid"), "true");
      assert.equal(await fileContent(), beforeCancel);
      await rename.fill("不应保存");
      await rename.press("Escape");
      await expectTitle("中间页");
      assert.equal(await fileContent(), beforeCancel);
      await startRename("尾页");
      await rename.fill("尾页新版");
      await group
        .getByRole("tab", {
          name: title,
          exact: true,
        })
        .click();
      await expectTitle("尾页新版");
      assert.equal(await fileContent(), beforeCancel.replace("tab: 尾页", "tab: 尾页新版"));

      // 右键菜单只打开确认界面，取消按钮和 Esc 都不删除内容。
      const beforeDelete = await fileContent();
      await requestDelete("中间页");
      assert.equal(await fileContent(), beforeDelete);
      assert.ok(
        await dialog
          .getByTestId("code-tab-delete-cancel")
          .evaluate((el) => el === document.activeElement),
      );
      await page.screenshot({
        path: join(directory, label + "-delete.png"),
      });
      await dialog.getByTestId("code-tab-delete-cancel").click();
      await dialog.waitFor({
        state: "detached",
      });
      assert.equal(await fileContent(), beforeDelete);
      await requestDelete("中间页");
      await page.keyboard.press("Escape");
      await dialog.waitFor({
        state: "detached",
      });
      assert.equal(await fileContent(), beforeDelete);

      // 删除非活动标签不切页；删除活动标签后选择相邻页。
      await group
        .getByRole("tab", {
          name: title,
          exact: true,
        })
        .click();
      await requestDelete("中间页");
      await confirmDelete();
      assert.equal(await group.getByRole("tab").count(), 2);
      assert.equal(
        await group
          .getByRole("tab", {
            name: title,
            exact: true,
          })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await fileContent(),
        beforeDelete.replace("\n\ntab: 中间页\n保留的 Markdown", ""),
      );
      await requestDelete(title);
      await confirmDelete();
      assert.equal(
        await group
          .getByRole("tab", {
            name: "尾页新版",
            exact: true,
          })
          .getAttribute("aria-selected"),
        "true",
      );

      // 前面的标签移除后，原来的第三页仍能重命名、编辑和新增，不能沿用过期下标。
      await startRename("尾页新版");
      await rename.fill("只剩一页");
      await rename.press("Enter");
      await expectTitle("只剩一页");
      await panel.locator("pre").click();
      await group.getByTestId("code-tab-editor").waitFor();
      await settle();
      await group.getByTestId("code-tab-editor").locator(".cm-content").focus();
      await page.keyboard.press("Meta+A");
      await page.keyboard.insertText("after-delete");
      await page.keyboard.press("Meta+Enter");
      await group.getByTestId("code-tab-editor").waitFor({
        state: "detached",
      });
      assert.ok((await fileContent()).includes("```text\nafter-delete\n```"));
      await group.getByTestId("code-tab-add").click();
      await group
        .getByRole("tab", {
          name: "标签2",
          exact: true,
        })
        .waitFor();
      await requestDelete("标签2");
      await confirmDelete();
      assert.equal(
        await group
          .getByRole("tab", {
            name: "只剩一页",
            exact: true,
          })
          .getAttribute("aria-selected"),
        "true",
      );
      await requestDelete("只剩一页");
      assert.ok((await dialog.innerText()).includes("整个标签组件也会移除"));
      await confirmDelete();
      assert.equal(await groups.count(), 1);
      assert.equal(await fileContent(), "\n\n" + other + "\n");
      reports.push({
        mode,
        theme,
        result: "passed",
      });
      console.log("PASS tab rename and delete", label);
    }
  }

  // 回写失败保留标题输入或确认弹窗，不能出现文件未写入、界面却已删除的状态。
  await reset();
  await page.evaluate(() => {
    window.originalTabActionProcess = app.vault.process;
    app.vault.process = async () => {
      throw new Error("test: tab action conflict");
    };
  });
  await startRename("首页");
  await rename.fill("冲突时保留的标题");
  await rename.press("Enter");
  await page
    .getByText("test: tab action conflict", {
      exact: true,
    })
    .first()
    .waitFor();
  assert.equal(await rename.inputValue(), "冲突时保留的标题");
  assert.equal(await fileContent(), initial);
  await rename.press("Escape");
  await expectTitle("首页");
  await requestDelete("首页");
  await dialog.getByTestId("code-tab-delete-confirm").click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="code-tab-delete-confirm"]').disabled,
  );
  assert.equal(await fileContent(), initial);
  assert.equal(await group.getByRole("tab").count(), 3);
  await dialog.getByTestId("code-tab-delete-cancel").click();

  // 延迟真实写入，重复确认只触发一次 process。
  await page.evaluate(() => {
    window.tabActionWrites = 0;
    app.vault.process = async function (...args) {
      window.tabActionWrites += 1;
      await new Promise((resolve) => {
        window.releaseTabAction = resolve;
      });
      return window.originalTabActionProcess.apply(this, args);
    };
  });
  await requestDelete("首页");
  await dialog.getByTestId("code-tab-delete-confirm").evaluate((button) => {
    button.click();
    button.click();
  });
  assert.equal(await page.evaluate(() => window.tabActionWrites), 1);
  await page.evaluate(() => window.releaseTabAction());
  await dialog.waitFor({
    state: "detached",
  });
  assert.equal(await group.getByRole("tab").count(), 2);
  assert.ok((await fileContent()).endsWith(other + "\n"));
  await page.evaluate(() => {
    app.vault.process = window.originalTabActionProcess;
  });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, "report.json"), JSON.stringify(reports, null, 2));
  console.log("PASS tab action conflicts and duplicate confirmation");
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
