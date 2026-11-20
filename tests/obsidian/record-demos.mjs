import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { launchTestVault } from "./host.mjs";

const output = new URL("../../docs/assets/demos/", import.meta.url);
const args = process.argv.slice(2);
const demoNames = ["tab-management", "code-completion", "tab-reference", "fence-pairing"];
if (args.length && !(args.length === 2 && args[0] === "--only" && demoNames.includes(args[1]))) {
  throw new Error("Usage: make demos, or npm run demo:record -- --only tab-reference");
}
const only = args[1];
const markdown = [
  "# Beyond-CodeTab",
  "",
  "Code and Markdown, side by side in your notes.",
  "",
  "````tab",
  "tab: Python",
  "```python",
  'names = ["Ada", "Linus"]',
  "```",
  "",
  "tab: JavaScript",
  "```javascript",
  "const greet = name => `Hello, ${name}!`;",
  'console.log(greet("Ada"));',
  "```",
  "",
  "tab: Markdown",
  "**Keep explanations next to your code.**",
  "",
  "| Language | Use |",
  "| --- | --- |",
  "| Python | Data and algorithms |",
  "| JavaScript | Web applications |",
  "````",
  "",
].join("\n");
const encoder = spawnSync("ffmpeg", ["-version"], {
  encoding: "utf8",
});
if (encoder.error || encoder.status !== 0) {
  throw new Error("Install FFmpeg first, then run make demos.");
}
await mkdir(output, {
  recursive: true,
});
const host = await launchTestVault(markdown);
const { page, directory, vault } = host;
const pluginBuildSha256 = createHash("sha256")
  .update(await readFile(join(vault, ".obsidian/plugins/obsidian-code-tab/main.js")))
  .digest("hex");
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const recordings = [];
const group = page
  .getByTestId("code-tab-group")
  .filter({
    visible: true,
  })
  .first();
const cdp = await page.context().newCDPSession(page);

async function caption(text) {
  await page.evaluate((text) => {
    document.getElementById("demo-caption").textContent = text;
  }, text);
}

async function reset() {
  await page.evaluate(async (markdown) => {
    await app.workspace.getLeaf().setViewState({
      type: "empty",
    });
    await app.vault.modify(app.vault.getFileByPath("Test.md"), markdown);
    app.plugins.plugins["obsidian-code-tab"].activeTabs.clear();
    document.body.removeClass("theme-dark");
    document.body.addClass("theme-light");
    await app.workspace.getLeaf().setViewState({
      type: "markdown",
      state: {
        file: "Test.md",
        mode: "preview",
        source: false,
      },
    });
  }, markdown);
  await group
    .getByRole("tab", {
      name: "Python",
      exact: true,
    })
    .waitFor();
  await page.mouse.move(900, 620);
  await pause(700);
}

async function clickTab(name) {
  const tab = group.getByRole("tab", {
    name,
    exact: true,
  });
  const bounds = await tab.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
    steps: 12,
  });
  await tab.click();
  await pause(850);
}

async function typeCode(text) {
  // 逐字发送真实输入；换行和缩进由示例提供，避免演示中被自动缩进重复添加。
  for (const character of text) {
    await page.keyboard.insertText(character);
    await pause(40);
  }
}

async function completeWord(prefix, word) {
  await page.keyboard.type(prefix, {
    delay: 180,
  });
  await page.keyboard.press("Control+Space");
  const candidate = page
    .locator(".code-tab__completion-tooltip li")
    .filter({
      has: page.getByText(word, {
        exact: true,
      }),
    })
    .first();
  await candidate.waitFor();
  await pause(300);
  assert.equal(
    await candidate.evaluate((option) => {
      const tooltip = option.closest(".code-tab__completion-tooltip");
      const box = option.getBoundingClientRect();
      const visible = [box.top + 2, box.top + box.height / 2, box.bottom - 2].every((y) =>
        option.contains(document.elementFromPoint(box.left + box.width / 2, y)),
      );
      return !tooltip.closest(".code-tab") && visible;
    }),
    true,
    "Record only the fixed build: completion candidates must be visible outside the card",
  );
  await pause(1500);
  await candidate.click();
}

async function record(name, title, action) {
  if (only && only !== name) {
    return;
  }
  const framesDirectory = join(directory, name);
  await mkdir(framesDirectory);
  const frames = [];
  const writes = [];
  const onFrame = (event) => {
    const filename = "frame-" + String(frames.length).padStart(5, "0") + ".jpg";
    frames.push({
      filename,
      time: performance.now() / 1000,
    });
    writes.push(writeFile(join(framesDirectory, filename), Buffer.from(event.data, "base64")));
    writes.push(
      cdp.send("Page.screencastFrameAck", {
        sessionId: event.sessionId,
      }),
    );
  };
  await caption(title);
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: 960,
    maxHeight: 660,
    everyNthFrame: 1,
  });
  let end;
  try {
    await pause(1000);
    await action();
    await pause(1500);
    end = performance.now() / 1000;
  } finally {
    await cdp.send("Page.stopScreencast");
    cdp.off("Page.screencastFrame", onFrame);
    await Promise.all(writes);
  }
  assert.ok(frames.length > 2, "The real Obsidian renderer must produce frames");
  const timeline = frames.map((frame, index) => {
    const duration = Math.max(0.001, (frames[index + 1]?.time ?? end) - frame.time);
    return "file '" + frame.filename + "'\nduration " + duration.toFixed(4);
  });
  timeline.push("file '" + frames.at(-1).filename + "'");
  const concat = join(framesDirectory, "frames.txt");
  await writeFile(concat, timeline.join("\n") + "\n");
  const gif = new URL(name + ".gif", output);
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concat,
      "-filter_complex",
      "fps=10,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop",
      "0",
      fileURLToPath(gif),
    ],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      fileURLToPath(gif),
    ],
    {
      encoding: "utf8",
    },
  );
  assert.equal(probe.status, 0, probe.error?.message ?? probe.stderr);
  const durationSeconds = Number(probe.stdout.trim());
  assert.ok(Number.isFinite(durationSeconds) && durationSeconds > 0);
  const recording = {
    file: name + ".gif",
    title,
    durationSeconds,
    capturedFrames: frames.length,
    bytes: (await stat(gif)).size,
    width: 960,
  };
  recordings.push(recording);
  console.log("Recorded " + recording.file + " (" + (recording.bytes / 1024).toFixed(0) + " KiB)");
}

try {
  await page.setViewportSize({
    width: 960,
    height: 660,
  });
  await page.evaluate(() => {
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    app.vault.setConfig("showInlineTitle", false);
    app.vault.setConfig("alwaysUpdateLinks", true);
    window.demoClipboard = [];
    window.require("electron").clipboard.writeText = (text) => window.demoClipboard.push(text);
    // Only OS protocol delivery is redirected; the registered plugin handler remains real.
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest?.('a[href^="obsidian://beyond-code-tab?"]');
        if (!link) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const params = Object.fromEntries(new URL(link.href).searchParams);
        window.demoNavigation =
          app.workspace.protocolHandler.handlers.get("beyond-code-tab")(params);
      },
      true,
    );
    const style = document.createElement("style");
    style.textContent = `
      #demo-caption { position: fixed; bottom: 14px; left: 22px; right: 22px; z-index: 10000;
        padding: 12px 16px; border: 1px solid #d4d9e1; border-radius: 10px;
        background: #f7f8fc; color: #26334d; font: 500 16px/1.4 system-ui; text-align: center; }
      #demo-cursor { position: fixed; top: -40px; left: -40px; width: 16px; height: 22px;
        z-index: 11000; pointer-events: none; filter: drop-shadow(0 1px 2px #0005); }
      .demo-click { position: fixed; width: 28px; height: 28px; border: 2px solid #7c56e8;
        border-radius: 50%; z-index: 10999; pointer-events: none; }
    `;
    document.head.appendChild(style);
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    document.body.appendChild(caption);
    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML =
      '<svg viewBox="0 0 16 22"><path d="M1 1v17l4-4 3 7 3-1-3-7h6z" fill="#202638" stroke="white" stroke-width="1.4"/></svg>';
    document.body.appendChild(cursor);
    document.addEventListener("mousemove", (event) => {
      cursor.style.left = event.clientX + "px";
      cursor.style.top = event.clientY + "px";
    });
    document.addEventListener("mousedown", (event) => {
      const ring = document.createElement("div");
      ring.className = "demo-click";
      ring.style.left = event.clientX - 14 + "px";
      ring.style.top = event.clientY - 14 + "px";
      document.body.appendChild(ring);
      ring
        .animate(
          [
            {
              opacity: 0.8,
              transform: "scale(.7)",
            },
            {
              opacity: 0,
              transform: "scale(1.7)",
            },
          ],
          {
            duration: 450,
          },
        )
        .finished.then(() => ring.remove());
    });
  });

  await reset();
  await record("tab-management", "Code and Markdown tabs · Switch, rename, reorder", async () => {
    await clickTab("JavaScript");
    await clickTab("Markdown");
    await caption("Double-click to rename · Drag to reorder");
    await group
      .getByRole("tab", {
        name: "Markdown",
        exact: true,
      })
      .dblclick();
    const rename = group.getByTestId("code-tab-rename");
    await rename.fill("Notes");
    await pause(700);
    await rename.press("Enter");
    await rename.waitFor({
      state: "detached",
    });
    await pause(700);
    const target = group.getByRole("tab", {
      name: "Python",
      exact: true,
    });
    await group
      .getByRole("tab", {
        name: "Notes",
        exact: true,
      })
      .dragTo(target, {
        targetPosition: {
          x: 3,
          y: 15,
        },
      });
    await pause(1000);
    assert.deepEqual(await group.getByRole("tab").allTextContents(), [
      "Notes",
      "Python",
      "JavaScript",
    ]);
    const text = await readFile(join(vault, "Test.md"), "utf8");
    assert.ok(text.indexOf("tab: Notes") < text.indexOf("tab: Python"));
  });

  await reset();
  await record(
    "code-completion",
    "Python quicksort · Write code with offline autocomplete",
    async () => {
      await group
        .getByTestId("code-tab-panel")
        .filter({
          visible: true,
        })
        .locator("pre")
        .click();
      const editor = group.getByTestId("code-tab-editor").locator(".cm-content");
      await pause(400);
      await editor.focus();
      await page.keyboard.press("Meta+a");
      await page.keyboard.press("Backspace");
      assert.equal(
        await page.evaluate(() => window.codeTabTestEmbed.editor.getValue()),
        "```python\n\n```",
      );
      await caption("1. Complete Python keywords and built-ins: def, if, len, return");
      await completeWord("de", "def");
      await typeCode(" quicksort(values):\n    ");
      await completeWord("i", "if");
      await typeCode(" ");
      await completeWord("le", "len");
      await typeCode("(values) < 2:\n        ");
      await completeWord("ret", "return");
      await typeCode(" values\n    pivot = values[");
      await completeWord("le", "len");
      await typeCode("(values) // 2]\n    less = [x ");
      await caption("2. Partition around the pivot · Complete for / in / if");
      await completeWord("fo", "for");
      await typeCode(" x ");
      await completeWord("i", "in");
      await typeCode(" values ");
      await completeWord("i", "if");
      await typeCode(" x < pivot]\n    equal = [x for x in values if x == pivot]\n");
      await typeCode("    greater = [x for x in values if x > pivot]\n    ");
      await caption("3. Join the recursive results · Save the complete quicksort example");
      await completeWord("ret", "return");
      await typeCode(" quicksort(less) + equal + quicksort(greater)\n\n");
      await completeWord("pri", "print");
      await typeCode("(quicksort([8, 3, 5, 1, 9, 3]))");
      const quicksort = [
        "def quicksort(values):",
        "    if len(values) < 2:",
        "        return values",
        "    pivot = values[len(values) // 2]",
        "    less = [x for x in values if x < pivot]",
        "    equal = [x for x in values if x == pivot]",
        "    greater = [x for x in values if x > pivot]",
        "    return quicksort(less) + equal + quicksort(greater)",
        "",
        "print(quicksort([8, 3, 5, 1, 9, 3]))",
      ].join("\n");
      assert.equal(
        await page.evaluate(() => window.codeTabTestEmbed.editor.getValue()),
        "```python\n" + quicksort + "\n```",
      );
      await pause(2500);
      await page.keyboard.press("Meta+Enter");
      await group.getByTestId("code-tab-editor").waitFor({
        state: "detached",
      });
      assert.ok((await readFile(join(vault, "Test.md"), "utf8")).includes(quicksort));
      const run = spawnSync("python3", ["-c", quicksort], {
        encoding: "utf8",
      });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout.trim(), "[1, 3, 3, 5, 8, 9]");
      await caption("Saved in your note · Offline word lists, no LSP required");
      await pause(3500);
    },
  );

  await reset();
  const referenceNote = "# Code references\n\nPaste a tab reference below:\n\n";
  if (!only || only === "tab-reference") {
    await page.evaluate(async (referenceNote) => {
      const sourceLeaf = app.workspace.getLeaf();
      const reference = await app.vault.create("Reference.md", referenceNote);
      const referenceLeaf = app.workspace.getLeaf("tab");
      await referenceLeaf.openFile(reference, {
        state: {
          mode: "source",
          source: true,
        },
      });
      app.workspace.setActiveLeaf(sourceLeaf, {
        focus: true,
      });
    }, referenceNote);
    await group.waitFor();
    await pause(700);
  }
  await record(
    "tab-reference",
    "Copy a tab link · Paste in another note · Jump back to that tab",
    async () => {
      await clickTab("JavaScript");
      await caption("1. Copy a reference to the JavaScript tab");
      await group.getByTestId("code-tab-reference").click();
      await page.waitForFunction(() =>
        window.demoClipboard.at(-1)?.includes("obsidian://beyond-code-tab?"),
      );
      await pause(2200);
      const reference = await page.evaluate(() => window.demoClipboard.at(-1));
      await caption("The link targets JavaScript · Leave Python selected in the source note");
      await clickTab("Python");
      await pause(1200);
      await caption("2. Switch to another Markdown note: Reference.md");
      await page
        .locator(".workspace-tab-header")
        .filter({
          has: page.getByText("Reference", {
            exact: true,
          }),
        })
        .click();
      await page.waitForFunction(
        () =>
          app.workspace.activeLeaf.view.file?.path === "Reference.md" &&
          app.workspace.activeLeaf.view.getMode() === "source",
      );
      await pause(1800);
      await page.evaluate(() => {
        const editor = app.workspace.activeLeaf.view.editor;
        const last = editor.lastLine();
        editor.setCursor({
          line: last,
          ch: editor.getLine(last).length,
        });
        editor.focus();
      });
      await caption("3. Paste the copied tab reference into this note");
      await pause(800);
      // 使用与真实回归相同的原生粘贴事件，走宿主处理并保留日常系统剪贴板。
      await page.evaluate((reference) => {
        const data = new DataTransfer();
        data.setData("text/plain", reference);
        app.workspace.activeLeaf.view.editor.cm.contentDOM.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        );
      }, reference);
      assert.equal(
        await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
        referenceNote + reference,
      );
      await pause(3200);
      await page.keyboard.press("Meta+s");
      await page.waitForFunction(
        async (expected) =>
          (await app.vault.read(app.vault.getFileByPath("Reference.md"))) === expected,
        referenceNote + reference,
      );
      await caption("4. View the pasted link · Click it to return to the JavaScript tab");
      await page
        .locator(".workspace-leaf.mod-active .view-action")
        .filter({
          has: page.locator("svg.lucide-book-open"),
        })
        .click();
      const link = page
        .locator('a[href^="obsidian://beyond-code-tab?"]')
        .filter({
          visible: true,
        })
        .first();
      await link.waitFor();
      assert.equal(await group.count(), 0);
      await pause(5000);
      const bounds = await link.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
        steps: 16,
      });
      await pause(600);
      await link.click();
      await page.evaluate(() => window.demoNavigation);
      await group
        .getByRole("tab", {
          name: "JavaScript",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await group
          .getByRole("tab", {
            name: "JavaScript",
            exact: true,
          })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.file.path), "Test.md");
      assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getMode()), "preview");
      await caption("5. Back in Test.md · JavaScript is selected, with Reading view preserved");
      await pause(4500);
    },
  );

  await page.evaluate(async () => {
    await app.vault.create("Fences.md", "# Paired Markdown fences\n\n");
    await app.workspace.openLinkText("Fences.md", "", false, {
      state: {
        mode: "source",
        source: true,
      },
    });
    const editor = app.workspace.activeLeaf.view.editor;
    editor.setCursor({
      line: 2,
      ch: 0,
    });
    editor.focus();
  });
  await record(
    "fence-pairing",
    "Markdown fences · Autocomplete, pair, and build code tabs",
    async () => {
      await caption("1. Type three backticks · Obsidian completes the closing fence");
      await page.keyboard.type("```", {
        delay: 280,
      });
      assert.ok(
        (await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue())).endsWith(
          "```\n```",
        ),
      );
      await pause(2500);
      await caption("2. Add one backtick · Both fences become four backticks");
      await page.keyboard.type("`");
      await pause(2500);
      await caption("3. Remove one backtick · Both fences return to three");
      await page.keyboard.press("Backspace");
      await pause(2500);
      await caption("Both ends change together · Undo restores the pair");
      await page.keyboard.press("Meta+z");
      await pause(2200);
      assert.ok(
        (await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue())).endsWith(
          "````\n````",
        ),
      );
      await caption("4. Paste four backticks, then Enter · A matching closing fence appears");
      await page.evaluate(() => {
        const editor = app.workspace.activeLeaf.view.editor;
        const last = editor.lastLine();
        editor.setSelection(
          {
            line: 2,
            ch: 0,
          },
          {
            line: last,
            ch: editor.getLine(last).length,
          },
        );
        editor.focus();
      });
      await page.keyboard.insertText("````");
      await pause(1800);
      await page.keyboard.press("Enter");
      assert.ok(
        (await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue())).endsWith(
          "````\n\n````",
        ),
      );
      await pause(2500);
      await caption("5. Use four backticks for tab · Nest three-backtick code blocks inside");
      await page.evaluate(() => {
        const editor = app.workspace.activeLeaf.view.editor;
        editor.setCursor({
          line: 2,
          ch: 4,
        });
        editor.focus();
      });
      await typeCode("tab");
      await page.evaluate(() => {
        app.workspace.activeLeaf.view.editor.setCursor({
          line: 3,
          ch: 0,
        });
      });
      await typeCode("tab: Python\n");
      await page.keyboard.type("```", {
        delay: 200,
      });
      await typeCode("python");
      await page.keyboard.press("Enter");
      await typeCode('print("Hello from Python")');
      await pause(2500);
      // 原生已经生成内层结束围栏，移到它后面继续创建下一页。
      await page.evaluate(() => {
        const editor = app.workspace.activeLeaf.view.editor;
        const closingLine = editor.getCursor().line + 1;
        if (editor.getLine(closingLine) !== "```") {
          throw new Error("The native editor must complete the inner closing fence");
        }
        editor.setCursor({
          line: closingLine,
          ch: 3,
        });
      });
      await page.keyboard.insertText("\n\n");
      await typeCode("tab: JavaScript\n");
      await page.keyboard.type("```", {
        delay: 200,
      });
      await typeCode("javascript");
      await page.keyboard.press("Enter");
      await typeCode('console.log("Hello from JavaScript");');
      const nested = [
        "# Paired Markdown fences",
        "",
        "````tab",
        "tab: Python",
        "```python",
        'print("Hello from Python")',
        "```",
        "",
        "tab: JavaScript",
        "```javascript",
        'console.log("Hello from JavaScript");',
        "```",
        "",
        "",
        "````",
      ].join("\n");
      assert.equal(
        await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()),
        nested,
      );
      await pause(3500);
      await page.keyboard.press("Meta+s");
      await page.waitForFunction(
        async (nested) => (await app.vault.read(app.vault.getFileByPath("Fences.md"))) === nested,
        nested,
      );
      await caption("6. Switch to Reading view · The nested blocks become two code tabs");
      await page.evaluate(() =>
        app.workspace.getLeaf().setViewState({
          type: "markdown",
          state: {
            file: "Fences.md",
            mode: "preview",
          },
        }),
      );
      await group.waitFor();
      await pause(2500);
      await clickTab("JavaScript");
      await pause(3000);
    },
  );

  assert.deepEqual(errors, []);
  const manifest = JSON.parse(
    await readFile(new URL("../../manifest.json", import.meta.url), "utf8"),
  );
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  });
  const report = {
    plugin: manifest.name,
    pluginVersion: manifest.version,
    sourceCommit: commit.stdout.trim(),
    sourceBuild: "Working-tree build based on sourceCommit",
    pluginBuildSha256,
    capture: "Real Obsidian renderer through the isolated tests/obsidian/host.mjs vault",
    recordings,
  };
  await writeFile(join(directory, "recordings.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Artifacts: " + directory);
} catch (error) {
  await page
    .screenshot({
      path: join(directory, "recording-failure.png"),
    })
    .catch(() => {});
  console.error("Artifacts: " + directory);
  throw error;
} finally {
  await cdp.detach().catch(() => {});
  await host.close();
}
