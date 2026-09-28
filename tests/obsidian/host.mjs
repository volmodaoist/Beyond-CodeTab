import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, open, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

/** 启动真实 Obsidian；配置、插件与测试笔记全部放入新建的临时目录。 */
export async function launchTestVault(initialMarkdown) {
  const executable = process.env.CODE_TAB_OBSIDIAN_BIN || "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
  const installedData = process.env.CODE_TAB_OBSIDIAN_DATA || join(homedir(), "Library/Application Support/obsidian");
  await access(executable);
  const directory = await mkdtemp(join(tmpdir(), "code-tab-e2e-"));
  const profile = join(directory, "profile");
  const vault = join(directory, "vault");
  const plugin = join(vault, ".obsidian/plugins/obsidian-code-tab");
  await mkdir(profile);
  await mkdir(plugin, { recursive: true });

  // 桌面安装器与实际应用版本可能不同，只复制本机已安装的更新包，不复制用户配置。
  const archives = await readdir(installedData).catch(() => []);
  for (const name of archives.filter((name) => /^obsidian-[\d.]+\.asar$/.test(name))) {
    await copyFile(join(installedData, name), join(profile, name));
  }
  for (const name of ["main.js", "styles.css", "manifest.json"]) {
    await copyFile(new URL("../../dist/" + name, import.meta.url), join(plugin, name));
  }
  await writeFile(join(profile, "obsidian.json"), JSON.stringify({
    vaults: { codetabe2e0000001: { path: vault, ts: Date.now(), open: true } },
  }));
  await writeFile(join(vault, ".obsidian/app.json"), JSON.stringify({
    defaultViewMode: "preview", showInlineTitle: true, livePreview: true,
  }));
  await writeFile(join(vault, ".obsidian/community-plugins.json"), '["obsidian-code-tab"]');
  await writeFile(join(vault, "Test.md"), initialMarkdown);

  const log = await open(join(directory, "obsidian.log"), "w");
  const child = spawn(executable, ["--user-data-dir=" + profile, "--remote-debugging-port=0"], {
    stdio: ["ignore", log.fd, log.fd],
  });
  let launchError;
  child.on("error", (error) => { launchError = error; });
  let browser;
  const close = async () => {
    try {
      await browser?.close();
    } finally {
      // 只关闭本脚本启动的进程，保留临时目录中的笔记、日志和截图供排查。
      child.kill("SIGTERM");
      await log.close();
    }
  };

  try {
    let port;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error("Obsidian exited; see " + directory);
      const activePort = await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
      if (activePort) { port = Number(activePort.split("\n")[0]); break; }
      await delay(250);
    }
    assert.ok(port, "Obsidian debugging endpoint did not start; see " + directory);
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent("page");
    page.setDefaultTimeout(10000);
    await page.waitForFunction(() => window.app?.vault?.adapter?.basePath);
    // 后续操作的硬边界：必须是本次创建的测试仓库，绝不能连接到用户已打开的仓库。
    assert.equal(await page.evaluate(() => app.vault.adapter.basePath), vault);
    if (process.env.CODE_TAB_SHOW_TEST_WINDOW !== "1") {
      // 隐藏本次独立窗口，避免桌面上的实际鼠标操作混入自动化事件，或测试抢占用户窗口。
      // 关闭后台节流后仍使用真实布局、绘制和 CodeMirror；CDP 输入与截图照常工作。
      await page.evaluate(() => {
        const testWindow = require("@electron/remote").getCurrentWindow();
        testWindow.webContents.setBackgroundThrottling(false);
        testWindow.hide();
      });
    }
    const trust = page.getByText(/^(信任仓库作者并启用插件|Trust author and enable plugins)$/);
    await trust.click();

    // 只观察插件创建的真实 embed，不替换 MarkdownRenderer、CodeMirror 或 Vault。
    // 首次启动偶尔会重载页面；waitForFunction 跨导航重试，且等工作区就绪后才安装观察器。
    await page.waitForFunction(() => {
      if (!window.app?.workspace?.layoutReady || !app.plugins.plugins["obsidian-code-tab"]) return false;
      const registry = app.embedRegistry;
      const original = registry.getEmbedCreator;
      registry.getEmbedCreator = function (...args) {
        const create = original.apply(this, args);
        return (...params) => (window.codeTabTestEmbed = create(...params));
      };
      return true;
    });
    return { page, directory, vault, close };
  } catch (error) {
    await close();
    throw error;
  }
}
