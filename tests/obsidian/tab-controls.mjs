import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchTestVault } from "./host.mjs";

const code = '```python\nprint("hello")\n```';
// 标签3 已存在，新增时必须跳过；另一个 tab 块验证操作不会误写到别处。
const firstBlock = "````tab\ntab: tab1\n" + code + "\n\ntab: 标签3\n说明\n````";
const otherBlock = "````tab\ntab: 保留\n```text\nuntouched\n```\n````";
const initial = firstBlock + "\n\n" + otherBlock + "\n";
const host = await launchTestVault(initial);
const { page, directory, vault } = host;
await page.setViewportSize({ width: 1000, height: 800 });
const errors = [];
const reports = [];
page.on("pageerror", (error) => errors.push(error.message));
const group = page.locator(".code-tab:visible").first();
const panel = group.locator(".code-tab__panel:not([hidden])");
const language = group.getByRole("textbox", { name: "编程语言" });
const content = group.locator(".code-tab__native-editor .cm-content");
const fileContent = () => readFile(join(vault, "Test.md"), "utf8");
const editorContent = () => page.evaluate(() => window.codeTabTestEmbed.editor.getValue());

async function reset(mode, theme) {
  await page.evaluate(async ({ initial, mode, theme }) => {
    const file = app.vault.getAbstractFileByPath("Test.md");
    if (await app.vault.read(file) !== initial) {
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
    // 每轮重新打开，避免上一轮选中的新增标签影响下一轮起点。
    await app.workspace.getLeaf().setViewState({ type: "empty" });
    app.plugins.plugins["obsidian-code-tab"].activeTabs.clear();
    document.body.removeClass("theme-light", "theme-dark");
    document.body.addClass("theme-" + theme);
    await app.workspace.getLeaf().setViewState({ type: "markdown", state: { file: "Test.md", mode } });
  }, { initial, mode, theme });
  await panel.locator("pre code").waitFor();
}

async function enterEditor() {
  await panel.locator("pre").click();
  await language.waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitForPreview() {
  await page.waitForFunction(() => ![...document.querySelectorAll(".code-tab.is-editing")].some((el) => el.checkVisibility()));
  await panel.locator("pre code").waitFor();
  // 预览出现后还会处理异步元数据通知，等宿主完成布局再操作按钮，避免点击已卸载的旧 DOM。
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function waitForLanguage(name) {
  await group.locator(".code-tab__native-editor.language-" + name.replace(/[+#.]/g, "\\$&")).waitFor();
}

try {
  for (const mode of ["preview", "source"]) for (const theme of ["light", "dark"]) {
    await reset(mode, theme);
    const label = mode + "-" + theme;
    assert.equal(await language.count(), 0, "预览态没有语言输入框");
    const before = await panel.boundingBox();
    await enterEditor();
    const editing = await panel.boundingBox();
    assert.ok(Math.abs(before.height - editing.height) < 1, "语言框不能撑高面板");
    const inputBounds = await language.boundingBox();
    assert.ok(inputBounds.y + inputBounds.height <= editing.y + editing.height, "语言框位于面板底部内侧");
    assert.equal(await language.inputValue(), "python");
    await page.evaluate(() => { window.originalCodeTabEditor = window.codeTabTestEmbed.editor.cm; });

    // 同一正文在 text 下取消着色，在 python 下恢复；未知语言也可保存为源文件语言名。
    await language.fill("text");
    await waitForLanguage("text");
    assert.equal(await content.locator(".code-tab__syntax").count(), 0);
    await language.fill("python");
    await waitForLanguage("python");
    assert.ok(await content.locator(".code-tab__syntax").count() > 0);
    await language.fill("c++");
    await waitForLanguage("cpp");
    assert.ok(await page.evaluate(() => window.originalCodeTabEditor === window.codeTabTestEmbed.editor.cm));
    assert.equal(await editorContent(), code, "切换着色不改写正文编辑器或围栏");
    await page.screenshot({ path: join(directory, label + "-language.png") });
    await language.press(mode === "preview" ? "Control+Enter" : "Meta+Enter");
    await waitForPreview();
    assert.equal(await fileContent(), initial.replace("```python", "```c++"));
    assert.equal(await panel.locator("pre code.language-cpp").count(), 1);
    assert.equal(await language.count(), 0);

    await enterEditor();
    await language.fill("unknown-language");
    await waitForLanguage("unknown-language");
    await language.press("Escape");
    await waitForPreview();
    assert.equal(await fileContent(), initial.replace("```python", "```c++"), "取消同时放弃语言修改");

    // 编辑后直接点 +：正文和语言先保存，新增空代码标签被选中，已有标签保持原样。
    await enterEditor();
    await content.focus();
    await page.keyboard.press("Meta+A");
    await page.keyboard.insertText("value = 42");
    await language.fill("ruby");
    await waitForLanguage("ruby");
    assert.ok(await content.locator(".token.number").count() > 0, "尚未使用过的 Ruby 语法也可加载");
    await group.getByRole("button", { name: "新增标签" }).click();
    await group.getByRole("tab", { name: "标签4", exact: true }).waitFor();
    assert.equal(await group.getByRole("tab", { name: "标签4", exact: true }).getAttribute("aria-selected"), "true");
    await panel.locator("pre code").waitFor();
    const withNewTab = await fileContent();
    assert.ok(withNewTab.includes("```ruby\nvalue = 42\n```"));
    assert.ok(withNewTab.includes("tab: 标签4\n```text\n\n```"));
    assert.ok(withNewTab.endsWith(otherBlock + "\n"), "另一个 tab 块不受影响");
    assert.equal(await group.getByRole("tab").count(), 3);

    // 新空代码块可以立即输入、选择语言和保存。
    await enterEditor();
    await content.focus();
    await page.keyboard.insertText("const answer = 42;");
    await language.fill("javascript");
    await waitForLanguage("javascript");
    await language.press("Enter");
    assert.ok(await content.evaluate((el) => el === el.ownerDocument.activeElement));
    await page.keyboard.press("Meta+Enter");
    await waitForPreview();
    assert.ok((await fileContent()).includes("tab: 标签4\n```javascript\nconst answer = 42;\n```"));

    // 同一帧快速重复激活，只允许一次写入。
    await group.getByRole("button", { name: "新增标签" }).evaluate((button) => {
      button.click();
      button.click();
    });
    await group.getByRole("tab", { name: "标签5", exact: true }).waitFor();
    assert.equal(await group.getByRole("tab").count(), 4);
    assert.equal((await fileContent()).match(/tab: 标签5/g)?.length, 1);
    await page.screenshot({ path: join(directory, label + "-added.png") });
    reports.push({ mode, theme, result: "passed" });
    console.log("PASS tab controls", label);
  }

  // 模拟回写冲突：保留当前可见 UI，底层文件变更时既不能覆盖文件也不能创建幽灵标签。
  await reset("preview", "light");
  const beforeConflict = await fileContent();
  await page.evaluate(() => {
    window.originalCodeTabProcess = app.vault.process;
    app.vault.process = async () => { throw new Error("test: concurrent file change"); };
  });
  await group.getByRole("button", { name: "新增标签" }).click();
  await page.getByText("test: concurrent file change", { exact: true }).waitFor();
  assert.equal(await group.getByRole("tab").count(), 2);
  assert.equal(await fileContent(), beforeConflict);
  await page.evaluate(() => { app.vault.process = window.originalCodeTabProcess; });

  // 原生 API 不可用时，语言输入也必须和 textarea 正文一起安全保存。
  await page.evaluate(() => { app.embedRegistry.getEmbedCreator = () => undefined; });
  await enterEditor();
  await group.locator("textarea").fill("SELECT 42;");
  await language.fill("sql");
  await language.press("Meta+Enter");
  await waitForPreview();
  assert.ok((await fileContent()).includes("```sql\nSELECT 42;\n```"));
  assert.deepEqual(errors, []);
  await writeFile(join(directory, "report.json"), JSON.stringify(reports, null, 2));
  console.log("PASS write conflict and fallback language");
  console.log("Artifacts:", directory);
} catch (error) {
  await page.screenshot({ path: join(directory, "failure.png") }).catch(() => {});
  console.error("Failure artifacts:", directory);
  throw error;
} finally {
  await host.close();
}
