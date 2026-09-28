import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchTestVault } from "./host.mjs";

const code = '```python\nprint("hello tab1")\n```';
const mixed = '说明\n\n```python\nprint("hello tab2")\n```';
const initial = "````tab\ntab: tab1\n" + code + "\n\ntab: tab2\n" + mixed + "\n````\n";
const host = await launchTestVault(initial);
const { page, directory, vault } = host;
const reports = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const group = page.getByTestId("code-tab-group").filter({
  visible: true,
});
const previewCode = group
  .getByTestId("code-tab-panel")
  .filter({
    visible: true,
  })
  .locator("pre code");
const fileContent = () => readFile(join(vault, "Test.md"), "utf8");
const editorContent = () => page.evaluate(() => window.codeTabTestEmbed.editor.getValue());

async function setNoteMarkdown(markdown) {
  await page.evaluate(async (markdown) => {
    const file = app.vault.getAbstractFileByPath("Test.md");
    if ((await app.vault.read(file)) === markdown) {
      return;
    }
    // 写入之后还会异步更新 metadata 并重建视图。等待本次内容被解析，避免下一轮
    // 刚创建编辑器就被上次文件修改的延迟通知卸载，形成与用户操作无关的测试竞态。
    const parsed = new Promise((resolve) => {
      const ref = app.metadataCache.on("changed", (changedFile, content) => {
        if (changedFile.path === file.path && content === markdown) {
          app.metadataCache.offref(ref);
          resolve();
        }
      });
    });
    await app.vault.modify(file, markdown);
    await parsed;
  }, markdown);
}

async function settleLayout() {
  // 原生高亮、焦点与 CodeMirror 测量分帧执行，等它们稳定后再测量和发送键盘事件。
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function enterEditor() {
  await previewCode.click();
  await group.locator(".code-tab__native-editor .cm-content").waitFor();
  await settleLayout();
  await group.locator(".code-tab__native-editor .cm-content").focus();
}

async function waitForPreview() {
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".code-tab.is-editing")].some((el) => el.checkVisibility()),
  );
  await previewCode.waitFor();
  await settleLayout();
}

async function paste(text) {
  // 通过原生 paste 事件走宿主的剪贴板处理逻辑，不改动系统剪贴板。
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    window.codeTabTestEmbed.editor.cm.contentDOM.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }, text);
}

async function snapshot() {
  return group.evaluate((group) => {
    const panel = group.querySelector(".code-tab__panel:not([hidden])");
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    };
    const line = panel.querySelector("pre code,.cm-line");
    const textNode = document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(5, textNode.length));
    const style = getComputedStyle(line);
    const scroll = panel.querySelector(".cm-scroller");
    const syntax = [];
    const walker = document.createTreeWalker(
      panel.querySelector("pre code,.cm-content"),
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const tokenStyle = getComputedStyle(node.parentElement);
      // CodeMirror 的行由 div 分隔，预览用换行符；只比较实际可见字符及其最终样式。
      for (const character of node.textContent) {
        if (/\s/.test(character)) {
          continue;
        }
        syntax.push({
          character,
          color: tokenStyle.color,
          weight: tokenStyle.fontWeight,
          style: tokenStyle.fontStyle,
        });
      }
    }
    return {
      group: rect(group),
      panel: rect(panel),
      surface: rect(panel.firstElementChild),
      text: rect(range),
      font: style.fontSize,
      lineHeight: style.lineHeight,
      scroll: scroll && {
        visible: scroll.clientHeight,
        total: scroll.scrollHeight,
      },
      syntax,
    };
  });
}

function sameGeometry(before, after, compareText = true, allowPageScroll = false) {
  for (const part of ["group", "panel", "surface", ...(compareText ? ["text"] : [])]) {
    for (const dimension of ["x", "y", "width", "height"]) {
      if (allowPageScroll && dimension === "y") {
        continue;
      }
      assert.ok(
        Math.abs(before[part][dimension] - after[part][dimension]) < 1,
        `${part}.${dimension}: ${before[part][dimension]} -> ${after[part][dimension]}`,
      );
    }
  }
  assert.equal(before.font, after.font);
  assert.equal(before.lineHeight, after.lineHeight);
  if (compareText) {
    sameSyntax(before, after);
  }
}

function growsWithContent(before, after) {
  assert.ok(after.surface.height > before.surface.height + 10, "增加行后代码框应该自然增高");
  for (const part of ["group", "panel", "surface"]) {
    assert.equal(after[part].width, before[part].width, part + " 的宽度不应随输入改变");
  }
  assert.ok(
    after.scroll.total <= after.scroll.visible + 1,
    "编辑器应展示全部内容，不产生内部纵向滚动",
  );
}

function sameSyntax(before, after) {
  assert.equal(before.syntax.length, after.syntax.length);
  for (let index = 0; index < before.syntax.length; index += 1) {
    assert.deepEqual(after.syntax[index], before.syntax[index], `字符 ${index} 的语法样式发生变化`);
  }
}

try {
  // 同时覆盖阅读视图和实时预览。后一种情况下，插件编辑器还嵌套在笔记的 CodeMirror 中。
  for (const mode of ["preview", "source"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [1000, 600]) {
        const label = `${mode}-${theme}-${width}`;
        await page.setViewportSize({
          width,
          height: 800,
        });
        await setNoteMarkdown(initial);
        await page.evaluate(
          async ({ mode, theme }) => {
            document.body.removeClass("theme-light", "theme-dark");
            document.body.addClass("theme-" + theme);
            const leaf = app.workspace.getLeaf();
            await leaf.setViewState({
              type: "markdown",
              state: {
                file: "Test.md",
                mode,
              },
            });
          },
          {
            mode,
            theme,
          },
        );
        // vault.modify 的通知异步重建预览，不能把上一轮仍挂在 DOM 中的代码块当作本轮结果。
        await page.waitForFunction(() => {
          const visible = [...document.querySelectorAll(".code-tab")].find((el) =>
            el.checkVisibility(),
          );
          return (
            visible
              ?.querySelector(".code-tab__panel:not([hidden]) pre code")
              ?.textContent.trim() === 'print("hello tab1")'
          );
        });
        await settleLayout();
        const before = await snapshot();
        await page.screenshot({
          path: join(directory, label + "-preview.png"),
        });
        await enterEditor();
        const editing = await snapshot();
        sameGeometry(before, editing);
        assert.ok(editing.scroll.total <= editing.scroll.visible + 1, "短代码不应出现多余滚动空间");
        await page.screenshot({
          path: join(directory, label + "-editing.png"),
        });

        // 回归用户的问题：不是直接写 EditorState，而是先按文末键、回车，再触发 paste。
        await page.keyboard.press("Meta+ArrowDown");
        await page.keyboard.press("Enter");
        await paste('print("new")');
        const appended = '```python\nprint("hello tab1")\nprint("new")\n```';
        assert.equal(await editorContent(), appended);
        await page.keyboard.press("Meta+z");
        await page.keyboard.press("Meta+Shift+z");
        assert.equal(await editorContent(), appended);
        await settleLayout();
        growsWithContent(before, await snapshot());
        await page.keyboard.press("Meta+Enter");
        await waitForPreview();
        const saved = initial.replace(code, appended);
        assert.equal(await fileContent(), saved, "保存必须写到围栏内，并保留另一标签");

        // 空正文重新输入不能多出换行；文首退格不能合并开头围栏。
        await enterEditor();
        await page.keyboard.press("Meta+ArrowUp");
        await page.keyboard.press("Backspace");
        assert.equal(await editorContent(), appended);
        await page.keyboard.press("Meta+A");
        await page.keyboard.press("Backspace");
        assert.equal(await editorContent(), "```python\n\n```");
        await page.keyboard.insertText("print(123)");
        assert.equal(await editorContent(), "```python\nprint(123)\n```");
        await page.keyboard.press("Escape");
        await waitForPreview();
        assert.equal(await fileContent(), saved, "取消不能写文件");

        const savedGeometry = await snapshot();
        await enterEditor();
        await page.keyboard.press("Meta+A");
        await paste(
          Array.from(
            {
              length: 30,
            },
            (_, index) => `print(${index})`,
          ).join("\n"),
        );
        await settleLayout();
        const longContent = await snapshot();
        growsWithContent(savedGeometry, longContent);
        assert.ok(
          longContent.surface.height >= 30 * Number.parseFloat(longContent.lineHeight),
          "30 行应完整撑开代码框",
        );
        // 删除后立即收缩，并保持输入会话；撤销后恢复长内容及其高度。
        await page.keyboard.press("Meta+A");
        await paste("print(1)");
        await settleLayout();
        const shortened = await snapshot();
        assert.ok(shortened.surface.height < longContent.surface.height - 100);
        assert.equal(await editorContent(), "```python\nprint(1)\n```");
        await page.keyboard.press("Meta+z");
        await settleLayout();
        growsWithContent(savedGeometry, await snapshot());
        await page.keyboard.press("Escape");
        await waitForPreview();
        sameGeometry(savedGeometry, await snapshot(), true, true);

        await enterEditor();
        await page.keyboard.press("Meta+A");
        await paste("print(456)");
        const bounds = await group.locator(".code-tab__panel:not([hidden])").boundingBox();
        // 在正文内移动再离开，避开 Electron 标题栏的可拖拽区域（它不派发普通鼠标事件）。
        await page.mouse.move(bounds.x + 20, bounds.y + 20);
        await page.mouse.move(bounds.x + 20, bounds.y + bounds.height + 20, {
          steps: 3,
        });
        await waitForPreview();
        assert.equal(await fileContent(), initial.replace(code, "```python\nprint(456)\n```"));
        reports.push({
          mode,
          theme,
          width,
          result: "passed",
        });
        console.log("PASS", label);
      }
    }
  }

  // 混合 Markdown 应保留全部源码；纯代码逻辑不能隐藏段落或第二个代码块。
  await group
    .getByRole("tab", {
      name: "tab2",
    })
    .click();
  await enterEditor();
  assert.equal(await editorContent(), mixed);
  await page.keyboard.press("Escape");
  await waitForPreview();
  await group
    .getByRole("tab", {
      name: "tab1",
    })
    .click();

  const languageCases = [
    ["python", "def greet(name):\n    # 中文😀\n    return len(name) + 42"],
    ["javascript", "const value = `hello ${name.toUpperCase()}`;\nconsole.log(value, /a+/g);"],
    ["c++", "#include <stdio.h>\nint main() { return 42; }"],
    ["html", '<div class="note">Hello &amp; world</div>'],
    ["css", '.note { color: red; font-family: "Arial"; }'],
    ["sql", "SELECT id FROM users WHERE name = 'test' AND age > 20;"],
    ["json", '{"name": "test", "count": 42, "active": true}'],
    ["unknown-language", 'print("plain") + 42'],
  ];
  for (const theme of ["light", "dark"]) {
    for (const [language, body] of languageCases) {
      const source = "```" + language + "\n" + body + "\n```";
      await page.setViewportSize({
        width: 1000,
        height: 800,
      });
      await setNoteMarkdown(initial.replace(code, source));
      await page.evaluate((theme) => {
        document.body.removeClass("theme-light", "theme-dark");
        document.body.addClass("theme-" + theme);
      }, theme);
      await page.waitForFunction((body) => {
        const visible = [...document.querySelectorAll(".code-tab")].find((el) =>
          el.checkVisibility(),
        );
        return (
          visible?.querySelector(".code-tab__panel:not([hidden]) pre code")?.textContent.trim() ===
          body
        );
      }, body);
      await settleLayout();
      const before = await snapshot();
      await enterEditor();
      sameSyntax(before, await snapshot());
      await page.keyboard.press("Escape");
      await waitForPreview();
      console.log("PASS colors", theme, language);
      reports.push({
        theme,
        language,
        result: "passed",
      });
    }
  }

  await setNoteMarkdown(initial);
  await page.waitForFunction(() => {
    const visible = [...document.querySelectorAll(".code-tab")].find((el) => el.checkVisibility());
    return (
      visible?.querySelector(".code-tab__panel:not([hidden]) pre code")?.textContent.trim() ===
      'print("hello tab1")'
    );
  });
  await settleLayout();

  // 私有 API 失效时仍能在原位编辑正文并保留围栏。
  await page.evaluate(() => {
    app.embedRegistry.getEmbedCreator = () => undefined;
  });
  await previewCode.click();
  const fallback = group.getByTestId("code-tab-fallback");
  const shortBounds = await fallback.boundingBox();
  await fallback.fill(
    Array.from(
      {
        length: 10,
      },
      (_, index) => `print(${index})`,
    ).join("\n"),
  );
  const longBounds = await fallback.boundingBox();
  assert.ok(longBounds.height > shortBounds.height + 100, "降级输入框也应随正文增高");
  await fallback.fill("print(789)");
  assert.ok((await fallback.boundingBox()).height < longBounds.height - 100);
  await fallback.press("Control+Enter");
  await waitForPreview();
  assert.equal(await fileContent(), initial.replace(code, "```python\nprint(789)\n```"));
  assert.deepEqual(errors, []);
  await writeFile(join(directory, "report.json"), JSON.stringify(reports, null, 2));
  console.log("PASS mixed Markdown and fallback editor");
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
