import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchTestVault } from "./host.mjs";

const table = (await readFile(new URL("../fixtures/table.md", import.meta.url), "utf8")).trimEnd();
const markdown = "````tab\ntab: 表格\n" + table + "\n\ntab: 对照\n```text\nuntouched\n```\n````\n";
const host = await launchTestVault(markdown);
const { page, directory, vault } = host;
const panel = page.getByTestId("code-tab-panel").filter({
  visible: true,
});
const editor = panel.getByTestId("code-tab-editor");
const reports = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const settle = () =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

async function show(mode) {
  await page.evaluate(async (mode) => {
    await app.workspace.getLeaf().setViewState({
      type: "empty",
    });
    await app.workspace.getLeaf().setViewState({
      type: "markdown",
      state: {
        file: "Test.md",
        mode,
      },
    });
  }, mode);
  await panel.locator("table").waitFor();
  await settle();
}

/** 从点击前就开始采样；只比较最终尺寸会漏掉焦点交接期间的一帧撑高。 */
async function observeTransition() {
  await panel.evaluate((panel) => {
    const samples = [];
    let frame;
    const rect = (element) => {
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    };
    const measure = () => {
      samples.push({
        panel: rect(panel),
        table: rect(panel.querySelector("table")),
      });
    };
    const tick = () => {
      measure();
      frame = requestAnimationFrame(tick);
    };
    // ResizeObserver 在本帧布局结束后测量，补上 rAF 回调之后发生的尺寸变化。
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    tick();
    window.finishTableTransition = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      measure();
      return samples;
    };
  });
}

function assertStable(samples) {
  assert.ok(samples.length > 2, "必须覆盖切换过程中的多个布局采样");
  const before = samples[0];
  for (const [index, sample] of samples.entries()) {
    for (const name of ["panel", "table"]) {
      assert.ok(sample[name], `第 ${index} 次采样丢失了 ${name}`);
      for (const dimension of ["x", "y", "width", "height"]) {
        assert.ok(
          Math.abs(sample[name][dimension] - before[name][dimension]) < 1,
          `第 ${index} 次采样 ${name}.${dimension}: ${before[name][dimension]} -> ${sample[name][dimension]}`,
        );
      }
    }
  }
}

async function assertBoundaryEditable(selector) {
  const visibleAndFocused = await editor
    .locator(".code-tab__cm-content")
    .evaluate((content, selector) => {
      const line = content.querySelector(selector);
      return document.activeElement === content && line.getBoundingClientRect().height > 0;
    }, selector);
  assert.ok(visibleAndFocused, "表格边界的真实空行必须能获得焦点且具有高度");
}

try {
  await page.setViewportSize({
    width: 1200,
    height: 1000,
  });
  for (const mode of ["preview", "source"]) {
    for (const [gesture, selector, clickCount, delay] of [
      ["single", "th", 1, 0],
      ["double-fast", "tbody tr:first-child td:nth-child(3)", 2, 0],
      ["double", "tbody tr:first-child td:first-child", 2, 80],
    ]) {
      await show(mode);
      const target = panel.locator(selector).first();
      const box = await target.boundingBox();
      await observeTransition();
      // 固定屏幕坐标，不让 locator 的稳定性等待掩盖两次点击之间的位移。
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
        clickCount,
        delay,
      });
      await editor.locator("table .cm-content").first().waitFor();
      await settle();
      const samples = await page.evaluate(() => window.finishTableTransition());
      const report = {
        mode,
        gesture,
        selector,
        samples,
      };
      reports.push(report);
      assertStable(samples);
      console.log("PASS table transition", mode, gesture);
    }

    // 上下边界必须仍能通过原生方向键进入；仅把所有空行永久压成 0 会在这里失败。
    await editor.locator("th").first().click();
    const firstCell = editor.locator("th .cm-content").first();
    await firstCell.press("Home");
    await firstCell.press("ArrowUp");
    await assertBoundaryEditable(":scope > .cm-line:first-child");
    await page.keyboard.insertText("表格前新增文字");
    await editor.locator("tbody tr").last().locator("td").first().click();
    const lastCell = editor.locator("tbody tr").last().locator(".cm-content");
    await lastCell.press("End");
    await lastCell.press("ArrowDown");
    await assertBoundaryEditable(":scope > .cm-line:last-child");
    await page.keyboard.insertText("表格后新增文字");
    const value = await page.evaluate(() => window.codeTabTestEmbed.editor.getValue());
    assert.ok(value.startsWith("表格前新增文字\n"));
    assert.ok(value.endsWith("\n表格后新增文字"));
    assert.ok(value.includes("allocation_trade_id"), "在边界输入不能破坏表格正文");
    await page.keyboard.press("Escape");
    await panel.locator("table").waitFor();
    assert.equal(await readFile(join(vault, "Test.md"), "utf8"), markdown, "取消编辑不能改变文件");
    console.log("PASS table boundary input", mode);
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({
    path: join(directory, "failure.png"),
  });
  throw error;
} finally {
  await writeFile(join(directory, "report.json"), JSON.stringify(reports, null, 2));
  console.log("Artifacts:", directory);
  await host.close();
}
