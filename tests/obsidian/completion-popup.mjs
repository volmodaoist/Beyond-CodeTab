import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { launchTestVault } from "./host.mjs";

const initial =
  '# Completion popup\n\n````tab\ntab: Python\n```python\nnames = ["Ada", "Linus"]\n```\n````\n\nA paragraph after the tab.\n';
const host = await launchTestVault(initial);
const { page, directory, vault } = host;
const reports = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const group = page
  .getByTestId("code-tab-group")
  .filter({
    visible: true,
  })
  .first();

try {
  for (const mode of ["preview", "source"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [960, 600]) {
        await page.setViewportSize({
          width,
          height: 660,
        });
        await page.evaluate(
          async ({ initial, mode, theme }) => {
            await app.workspace.getLeaf().setViewState({
              type: "empty",
            });
            await app.vault.modify(app.vault.getFileByPath("Test.md"), initial);
            document.body.removeClass("theme-light", "theme-dark");
            document.body.addClass("theme-" + theme);
            await app.workspace.getLeaf().setViewState({
              type: "markdown",
              state: {
                file: "Test.md",
                mode,
                source: false,
              },
            });
          },
          {
            initial,
            mode,
            theme,
          },
        );
        await group.waitFor();
        await group
          .getByTestId("code-tab-panel")
          .filter({
            visible: true,
          })
          .locator("pre")
          .click();
        const editor = group.getByTestId("code-tab-editor").locator(".cm-content");
        await editor.focus();
        await page.keyboard.press("Meta+a");
        await page.keyboard.insertText('names = ["Ada", "Linus"]\nenu');
        await editor.press("Control+Space");
        const candidate = page
          .locator(".code-tab__completion-tooltip li")
          .filter({
            hasText: "enumerate",
          })
          .first();
        await candidate.waitFor();
        await pause(150);
        const withPopup = await group.boundingBox();
        await editor.press("Escape");
        await candidate.waitFor({
          state: "detached",
        });
        assert.equal(await group.getByTestId("code-tab-editor").count(), 1);
        const withoutPopup = await group.boundingBox();
        assert.ok(
          Math.abs(withPopup.height - withoutPopup.height) < 1,
          "Completion must not change card height",
        );
        await editor.press("Control+Space");
        await candidate.waitFor();
        await pause(150);
        const result = await candidate.evaluate((option) => {
          const tooltip = option.closest(".code-tab__completion-tooltip");
          const box = tooltip.getBoundingClientRect();
          const optionBox = option.getBoundingClientRect();
          const points = [
            optionBox.top + 2,
            optionBox.top + optionBox.height / 2,
            optionBox.bottom - 2,
          ];
          const visible = points.every((y) =>
            option.contains(document.elementFromPoint(optionBox.left + optionBox.width / 2, y)),
          );
          return {
            outsideCard: !tooltip.closest(".code-tab"),
            visible,
            top: box.top,
            bottom: box.bottom,
            viewportHeight: innerHeight,
          };
        });
        assert.equal(
          result.outsideCard,
          true,
          "The completion popup must be outside the clipping card",
        );
        assert.equal(
          result.visible,
          true,
          "All parts of a candidate must remain visible and clickable",
        );
        assert.ok(
          result.top >= 0 && result.bottom <= result.viewportHeight,
          "Popup stays inside the viewport",
        );
        const bounds = await candidate.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await pause(250);
        assert.equal(
          await group.getByTestId("code-tab-editor").count(),
          1,
          "Entering a portalled candidate must not save the editor",
        );
        assert.equal(await readFile(join(vault, "Test.md"), "utf8"), initial);
        await page.screenshot({
          path: join(directory, mode + "-" + theme + "-" + width + ".png"),
        });
        await candidate.click();
        assert.ok(
          await page.evaluate(() =>
            window.codeTabTestEmbed.editor.getValue().includes("enumerate"),
          ),
        );
        await editor.press("Meta+Enter");
        await group.getByTestId("code-tab-editor").waitFor({
          state: "detached",
        });
        assert.ok((await readFile(join(vault, "Test.md"), "utf8")).includes("enumerate"));
        assert.equal(
          await page.locator(".code-tab__completion-tooltip").count(),
          0,
          "Saving must remove the popup",
        );
        reports.push({
          mode,
          theme,
          width,
          passed: true,
          result,
        });
      }
    }
  }
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
  console.log("Completion popup: " + reports.length + " scenarios passed");
  console.log("Artifacts: " + directory);
} catch (error) {
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
