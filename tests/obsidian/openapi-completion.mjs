import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchTestVault } from "./host.mjs";

const initial =
  "# API 回归\n\n````tab\ntab: 普通标签\n```python\nprint(1)\n```\n\ntab: 文档\n正文\n````\n";
const host = await launchTestVault(initial);
const { page, directory, vault } = host;
const reports = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

async function check(name, task) {
  const result = await task();
  reports.push({
    name,
    passed: true,
    result,
  });
}

try {
  await page.setViewportSize({
    width: 1150,
    height: 900,
  });
  await page.evaluate(async () => {
    await app.workspace.getLeaf().setViewState({
      type: "markdown",
      state: {
        file: "Test.md",
        mode: "preview",
      },
    });
  });
  await page
    .getByTestId("code-tab-group")
    .filter({
      visible: true,
    })
    .first()
    .waitFor();
  await page.evaluate(() => {
    const request = {};
    document.dispatchEvent(
      new CustomEvent("obsidian-code-tab-api", {
        detail: request,
      }),
    );
    if (!request.api) {
      throw new Error("公开 API 未注册");
    }
    window.codeTabApi = request.api;
    const plugin = app.plugins.plugins["obsidian-code-tab"];
    let prototype = Object.getPrototypeOf(plugin);
    while (
      prototype &&
      !(Object.hasOwn(prototype, "addChild") && Object.hasOwn(prototype, "register"))
    ) {
      prototype = Object.getPrototypeOf(prototype);
    }
    if (!prototype) {
      throw new Error("无法取得真实宿主 Component");
    }
    window.TestComponent = prototype.constructor;
    const area = document.createElement("div");
    area.id = "code-tab-api-fixtures";
    Object.assign(area.style, {
      position: "fixed",
      top: "30px",
      left: "20px",
      right: "20px",
      bottom: "20px",
      overflow: "auto",
      background: "var(--background-primary)",
      zIndex: "500",
    });
    document.body.appendChild(area);
    window.apiFixtures = [];
    window.createApiFixture = async (source, options = {}) => {
      const parent = options.parent ?? new window.TestComponent();
      if (!options.parent) {
        parent.load();
      }
      const container = options.container ?? document.createElement("div");
      if (!options.container) {
        area.appendChild(container);
      }
      container.style.marginBottom = "16px";
      const fixture = {
        parent,
        container,
        source,
        changes: [],
        editing: [],
        fail: false,
        wait: null,
        handle: null,
      };
      fixture.handle = await window.codeTabApi.render({
        component: parent,
        container,
        id: "shared-id",
        source,
        sourcePath: "Test.md",
        readOnly: options.readOnly,
        onChange: options.noCallback
          ? undefined
          : async (expected, next) => {
              if (expected !== fixture.source) {
                throw new Error("source conflict");
              }
              if (fixture.fail) {
                throw new Error("fixture save failure");
              }
              if (fixture.wait) {
                await fixture.wait;
              }
              fixture.source = next ?? "";
              fixture.changes.push({
                expected,
                next,
              });
            },
        onEditingChange: (editing) => fixture.editing.push(editing),
      });
      window.apiFixtures.push(fixture);
      return fixture;
    };
    window.baseApiSource = "tab: 第一页\n```python\npri\n```\n\ntab: 第二页\n链接 [[Test]] 与正文";
  });

  await check("能力发现、同 id 实例隔离和只读", async () =>
    page.evaluate(async () => {
      const a = await window.createApiFixture(window.baseApiSource);
      const b = await window.createApiFixture(window.baseApiSource, {
        noCallback: true,
      });
      a.container.id = "api-primary";
      a.handle.selectTab(1);
      if (b.handle.getSnapshot().activeIndex !== 0) {
        throw new Error("实例串状态");
      }
      if (
        !b.handle.getSnapshot().readOnly ||
        b.container.querySelector('[data-testid="code-tab-add"]')
      ) {
        throw new Error("只读失效");
      }
      try {
        b.handle.startEditing();
        throw new Error("只读未拒绝");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.ReadOnly) {
          throw error;
        }
      }
      const old = {
        version: 1,
        language: "tab",
        handled: false,
      };
      document.dispatchEvent(
        new CustomEvent("obsidian-codeblock-render", {
          detail: old,
        }),
      );
      if (old.handled) {
        throw new Error("旧渲染协议仍存在");
      }
      window.primary = a;
      b.parent.unload();
      return a.handle.getSnapshot();
    }),
  );

  await check("同值更新无重建、订阅可取消", async () =>
    page.evaluate(async () => {
      const button = window.primary.container.querySelector('[data-testid="code-tab-tab"]');
      const revision = window.primary.handle.getSnapshot().revision;
      let notifications = 0;
      const unsubscribe = window.primary.handle.subscribe(() => notifications++);
      await window.primary.handle.update({
        source: window.primary.source,
      });
      if (
        button !== window.primary.container.querySelector('[data-testid="code-tab-tab"]') ||
        revision !== window.primary.handle.getSnapshot().revision
      ) {
        throw new Error("同值重建");
      }
      window.primary.handle.selectTab(0);
      const count = notifications;
      unsubscribe();
      window.primary.handle.selectTab(1);
      if (notifications !== count) {
        throw new Error("订阅未取消");
      }
      return notifications;
    }),
  );

  await check("外部更新无保存回声、保留活动标签与焦点", async () =>
    page.evaluate(async () => {
      const before = window.primary.changes.length;
      window.primary.handle.focus();
      const source = "tab: 新增页\n新增正文\n\n" + window.baseApiSource;
      window.primary.source = source;
      await window.primary.handle.update({
        source,
      });
      if (
        window.primary.changes.length !== before ||
        window.primary.handle.getSnapshot().activeIndex !== 2
      ) {
        throw new Error("更新或选择失效");
      }
      if (document.activeElement?.textContent !== "第二页") {
        throw new Error("焦点未保留");
      }
      await window.primary.handle.update({
        readOnly: true,
      });
      if (window.primary.container.querySelector('[data-testid="code-tab-add"]')) {
        throw new Error("只读更新失效");
      }
      await window.primary.handle.update({
        readOnly: false,
      });
      if (!window.primary.container.querySelector('[data-testid="code-tab-add"]')) {
        throw new Error("编辑能力未恢复");
      }
      return window.primary.handle.getSnapshot();
    }),
  );

  await check("批量事务、失败重试及内容版本校验", async () =>
    page.evaluate(async () => {
      const snapshot = window.primary.handle.getSnapshot();
      const operations = [
        {
          type: "insert-tab",
          index: 0,
          tab: {
            title: "API 新页",
            content: "新内容",
          },
        },
        {
          type: "move-tab",
          fromIndex: 0,
          toIndex: 3,
        },
      ];
      window.primary.fail = true;
      try {
        await window.primary.handle.apply(operations, {
          expectedRevision: snapshot.revision,
        });
        throw new Error("保存未拒绝");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.CommitFailed) {
          throw error;
        }
      }
      if (window.primary.handle.getSnapshot().source !== snapshot.source) {
        throw new Error("失败污染源码");
      }
      window.primary.fail = false;
      await window.primary.handle.apply(operations, {
        expectedRevision: snapshot.revision,
      });
      if (
        window.primary.handle.getSnapshot().tabs.filter((tab) => tab.title === "API 新页")
          .length !== 1
      ) {
        throw new Error("重试重复插入");
      }
      try {
        await window.primary.handle.apply(operations, {
          expectedRevision: snapshot.revision,
        });
        throw new Error("旧版本未拒绝");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.RevisionMismatch) {
          throw error;
        }
      }
      return window.primary.changes.length;
    }),
  );

  await check("在途保存拒绝外部变更", async () =>
    page.evaluate(async () => {
      let resolve;
      window.primary.wait = new Promise((done) => {
        resolve = done;
      });
      const pending = window.primary.handle.apply(
        [
          {
            type: "replace-tab",
            index: 0,
            tab: {
              title: "改名",
              content: "新正文",
            },
          },
        ],
        {
          expectedRevision: window.primary.handle.getSnapshot().revision,
        },
      );
      if (!window.primary.handle.getSnapshot().saving) {
        throw new Error("保存状态未暴露");
      }
      try {
        await window.primary.handle.update({
          source: "tab: 外部\n覆盖",
        });
        throw new Error("忙碌更新未拒绝");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.Busy) {
          throw error;
        }
      }
      resolve();
      await pending;
      window.primary.wait = null;
      return window.primary.handle.getSnapshot().source;
    }),
  );

  await check("空组、最后一页删除与容器身份", async () =>
    page.evaluate(async () => {
      const fixture = await window.createApiFixture("");
      await fixture.handle.apply(
        [
          {
            type: "insert-tab",
            index: 0,
            tab: {
              title: "唯一页",
              content: "正文",
            },
          },
        ],
        {
          expectedRevision: 0,
        },
      );
      await fixture.handle.apply(
        [
          {
            type: "remove-tab",
            index: 0,
          },
        ],
        {
          expectedRevision: 1,
        },
      );
      if (
        !fixture.container.isConnected ||
        fixture.handle.getSnapshot().activeIndex !== null ||
        fixture.changes.at(-1).next !== null
      ) {
        throw new Error("空状态或容器身份失效");
      }
      fixture.parent.unload();
      fixture.handle.dispose();
      try {
        fixture.handle.getSnapshot();
        throw new Error("释放未生效");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.Disposed) {
          throw error;
        }
      }
    }),
  );

  await check("父组件卸载释放多个实例", async () =>
    page.evaluate(async () => {
      const parent = new window.TestComponent();
      parent.load();
      const a = await window.createApiFixture(window.baseApiSource, {
        parent,
      });
      const b = await window.createApiFixture(window.baseApiSource, {
        parent,
      });
      parent.unload();
      for (const fixture of [a, b]) {
        try {
          await fixture.handle.update({
            source: "tab: x\ny",
          });
          throw new Error("子组件未释放");
        } catch (error) {
          if (error.code !== window.codeTabApi.errorCodes.Disposed) {
            throw error;
          }
        }
      }
    }),
  );

  await check("初始化失败后容器可重用、未加载父组件拒绝", async () =>
    page.evaluate(async () => {
      const parent = new window.TestComponent();
      const container = document.createElement("div");
      document.getElementById("code-tab-api-fixtures").appendChild(container);
      try {
        await window.codeTabApi.render({
          component: parent,
          container,
          id: "failure",
          source: window.baseApiSource,
          sourcePath: "Test.md",
        });
        throw new Error("未加载父组件未拒绝");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.InvalidOptions) {
          throw error;
        }
      }
      parent.load();
      const original = container.empty;
      let fail = true;
      container.empty = function () {
        if (fail) {
          fail = false;
          throw new Error("fixture init failure");
        }
        return original.call(this);
      };
      try {
        await window.codeTabApi.render({
          component: parent,
          container,
          id: "failure",
          source: window.baseApiSource,
          sourcePath: "Test.md",
        });
        throw new Error("初始化失败未拒绝");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.RenderFailed) {
          throw error;
        }
      }
      container.empty = original;
      const fixture = await window.createApiFixture(window.baseApiSource, {
        parent,
        container,
      });
      if (fixture.handle.getSnapshot().tabs.length !== 2) {
        throw new Error("容器未释放");
      }
      parent.unload();
    }),
  );

  await check("初始化期间卸载、迟到结果不能覆盖复用容器", async () =>
    page.evaluate(async () => {
      const parent = new window.TestComponent();
      parent.load();
      const container = document.createElement("div");
      document.getElementById("code-tab-api-fixtures").appendChild(container);
      const pending = window.codeTabApi
        .render({
          component: parent,
          container,
          id: "initializing",
          source: window.baseApiSource,
          sourcePath: "Test.md",
        })
        .catch((error) => error);
      parent.unload();
      const fixture = await window.createApiFixture("tab: 新组件\n新正文", {
        container,
      });
      const error = await pending;
      if (
        error.code !== window.codeTabApi.errorCodes.Disposed ||
        fixture.handle.getSnapshot().tabs[0].title !== "新组件"
      ) {
        throw new Error("迟到初始化污染组件");
      }
      fixture.parent.unload();
    }),
  );

  await check("保存期间释放、迟到回调不修改新 UI", async () =>
    page.evaluate(async () => {
      const fixture = await window.createApiFixture(window.baseApiSource);
      let resolve;
      fixture.wait = new Promise((done) => {
        resolve = done;
      });
      const pending = fixture.handle
        .apply(
          [
            {
              type: "replace-tab",
              index: 0,
              tab: {
                title: "旧异步",
                content: "旧数据",
              },
            },
          ],
          {
            expectedRevision: 0,
          },
        )
        .catch((error) => error);
      fixture.handle.dispose();
      const replacement = await window.createApiFixture("tab: 新 UI\n保留", {
        container: fixture.container,
      });
      resolve();
      const error = await pending;
      if (
        error.code !== window.codeTabApi.errorCodes.Disposed ||
        replacement.container.textContent.includes("旧异步")
      ) {
        throw new Error("迟到回调污染 UI");
      }
      replacement.parent.unload();
    }),
  );

  await check("已接受保存后的预览失败不重复提交，外部更新可以重试", async () => {
    for (const action of ["update", "apply", "commit"]) {
      await page.evaluate(async (action) => {
        const fixture = await window.createApiFixture("tab: 渲染失败\n原正文");
        const panel = fixture.container.querySelector('[data-testid="code-tab-panel"]');
        if (action === "commit") {
          fixture.handle.startEditing();
          window.codeTabTestEmbed.editor.setValue("新正文");
        }
        const original = panel.empty;
        let fail = true;
        panel.empty = function () {
          if (fail) {
            fail = false;
            throw new Error("fixture preview failure");
          }
          return original.call(this);
        };
        try {
          if (action === "update") {
            fixture.source = "tab: 渲染失败\n新正文";
            await fixture.handle.update({
              source: fixture.source,
            });
          } else if (action === "apply") {
            await fixture.handle.apply(
              [
                {
                  type: "replace-tab",
                  index: 0,
                  tab: {
                    title: "渲染失败",
                    content: "新正文",
                  },
                },
              ],
              {
                expectedRevision: 0,
              },
            );
          } else {
            await fixture.handle.commit();
          }
          throw new Error("预览失败未拒绝");
        } catch (error) {
          if (error.code !== window.codeTabApi.errorCodes.RenderFailed) {
            throw error;
          }
        }
        const snapshot = fixture.handle.getSnapshot();
        if (
          !snapshot.source.includes("新正文") ||
          snapshot.rendering ||
          snapshot.saving ||
          snapshot.editing
        ) {
          throw new Error("失败后内容或状态错误");
        }
        const count = action === "update" ? 0 : 1;
        if (fixture.changes.length !== count) {
          throw new Error("保存次数错误");
        }
        panel.empty = original;
        await fixture.handle.update({
          source: snapshot.source,
        });
        if (
          !panel.textContent.includes("新正文") ||
          fixture.changes.length !== count ||
          fixture.handle.getSnapshot().revision !== snapshot.revision
        ) {
          throw new Error("重试预览产生重复保存或版本变化");
        }
        fixture.parent.unload();
      }, action);
    }
  });

  await check("CRLF 原始匹配依据保留", async () =>
    page.evaluate(async () => {
      const source = window.baseApiSource.replace(/\n/g, "\r\n");
      const fixture = await window.createApiFixture(source);
      await fixture.handle.apply(
        [
          {
            type: "replace-tab",
            index: 1,
            tab: {
              title: "CRLF",
              content: "保存",
            },
          },
        ],
        {
          expectedRevision: 0,
        },
      );
      if (fixture.changes[0].expected !== source || /(?<!\r)\n/.test(fixture.changes[0].next)) {
        throw new Error("换行匹配依据丢失");
      }
      fixture.parent.unload();
    }),
  );

  await page.evaluate(async () => {
    window.primary.source = window.baseApiSource;
    await window.primary.handle.update({
      source: window.baseApiSource,
    });
    window.primary.handle.selectTab(0);
    window.primary.handle.startEditing();
  });
  const group = page.locator("#api-primary");
  await group.getByTestId("code-tab-editor").waitFor();
  await check("正文编辑和标题输入期间保留草稿", async () =>
    page.evaluate(async () => {
      try {
        await window.primary.handle.update({
          source: "tab: overwrite\nnew",
        });
        throw new Error("编辑未保护");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.Busy) {
          throw error;
        }
      }
      if (window.primary.editing.at(-1) !== true) {
        throw new Error("未通知编辑开始");
      }
      await window.primary.handle.cancel();
      if (window.primary.editing.at(-1) !== false) {
        throw new Error("未通知编辑结束");
      }
    }),
  );

  await group
    .getByRole("tab", {
      name: "第一页",
      exact: true,
    })
    .dblclick();
  await group.getByTestId("code-tab-rename").waitFor();
  await check("改名草稿阻止外部更新", async () =>
    page.evaluate(async () => {
      const input = window.primary.container.querySelector('[data-testid="code-tab-rename"]');
      input.value = "草稿标题";
      try {
        await window.primary.handle.update({
          source: "tab: overwrite\nnew",
        });
        throw new Error("标题未保护");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.Busy) {
          throw error;
        }
      }
      if (input.value !== "草稿标题") {
        throw new Error("标题草稿丢失");
      }
    }),
  );
  await group.getByTestId("code-tab-rename").press("Escape");

  for (const [language, prefix, word] of [
    ["java", "pub", "public"],
    ["c", "pri", "printf"],
    ["cpp", "vec", "vector"],
    ["python", "enu", "enumerate"],
    ["ts", "key", "keyof"],
    ["js", "con", "const"],
    ["go", "def", "defer"],
    ["shell", "ech", "echo"],
  ]) {
    await check(`真实原生补全 ${language}`, async () => {
      await page.evaluate(
        async ({ language, prefix }) => {
          const source = "tab: 代码\n```" + language + "\n" + prefix + "\n```";
          window.primary.source = source;
          await window.primary.handle.update({
            source,
          });
          window.primary.handle.startEditing();
        },
        {
          language,
          prefix,
        },
      );
      await group.getByTestId("code-tab-editor").waitFor();
      const editor = group.locator(".cm-content").first();
      await editor.press("Meta+End");
      await editor.press("Control+Space");
      assert.equal(
        await page.evaluate(() => window.codeTabTestEmbed.editor.cm.state.selection.main.head),
        ("```" + language + "\n" + prefix).length,
      );
      const candidate = page
        .locator(".code-tab__completion-tooltip li")
        .filter({
          hasText: word,
        })
        .first();
      await candidate.waitFor();
      await candidate.click();
      await page.evaluate(
        async ({ word, prefix }) => {
          await window.primary.handle.commit();
          const expected = window.primary.source.replace("\n" + prefix + "\n", "\n" + word + "\n");
          if (
            !window.primary.source.includes("\n" + word + "\n") ||
            !window.primary.source.endsWith("\n```")
          ) {
            throw new Error(
              "补全插入或围栏错误: " + window.primary.source + " expected " + expected,
            );
          }
        },
        {
          word,
          prefix,
        },
      );
      await group.getByTestId("code-tab-editor").waitFor({
        state: "detached",
      });
    });
  }

  await check("用户词表、正则规则和配置更新可以被实际编辑器消费", async () => {
    await page.evaluate(async () => {
      window.codeTabApi.completion.registerWords({
        id: "e2e-word",
        languages: ["shell"],
        words: [
          {
            label: "deployLocal",
            insertText: "echo deploy",
          },
        ],
      });
      window.codeTabApi.completion.registerRule({
        id: "e2e-rule",
        languages: ["shell"],
        match: /docker\s+\w*$/,
        words: ["composeLocal"],
      });
      window.primary.source = "tab: 自定义\n```shell\ndocker co\n```";
      await window.primary.handle.update({
        source: window.primary.source,
      });
      window.primary.handle.startEditing();
    });
    const editor = group.locator(".cm-content").first();
    await editor.press("Meta+End");
    await editor.press("Control+Space");
    await page
      .locator(".code-tab__completion-tooltip li")
      .filter({
        hasText: "composeLocal",
      })
      .click();
    await page.evaluate(async () => {
      await window.primary.handle.commit();
      if (!window.primary.source.includes("docker composeLocal")) {
        throw new Error("规则未消费");
      }
      window.primary.source = "tab: 自定义\n```shell\ndepl\n```";
      await window.primary.handle.update({
        source: window.primary.source,
      });
      window.primary.handle.startEditing();
    });
    await editor.press("Meta+End");
    await editor.press("Control+Space");
    await page
      .locator(".code-tab__completion-tooltip li")
      .filter({
        hasText: "deployLocal",
      })
      .click();
    await page.evaluate(async () => {
      await window.primary.handle.commit();
      if (!window.primary.source.includes("\necho deploy\n")) {
        throw new Error("自定义词表未消费");
      }
      window.codeTabApi.completion.unregister("e2e-word");
      window.codeTabApi.completion.unregister("e2e-rule");
    });
  });

  await check("Esc 先关闭补全，后取消编辑", async () => {
    await page.evaluate(async () => {
      window.primary.source = "tab: Esc\n```python\npri\n```";
      await window.primary.handle.update({
        source: window.primary.source,
      });
      window.primary.handle.startEditing();
    });
    const editor = group.locator(".cm-content").first();
    await editor.press("Meta+End");
    await editor.press("Control+Space");
    await page.locator(".code-tab__completion-tooltip").waitFor();
    await editor.press("Escape");
    assert.equal(await group.getByTestId("code-tab-editor").count(), 1);
    await editor.press("Escape");
    await group.getByTestId("code-tab-editor").waitFor({
      state: "detached",
    });
  });

  await check("设置配置校验、持久化和重新加载", async () => {
    const willPopout = await page.evaluate(() => !!app.setting.shouldUsePopout?.());
    const popup = willPopout ? page.context().waitForEvent("page") : Promise.resolve(page);
    await page.evaluate(() => {
      document.getElementById("code-tab-api-fixtures").style.display = "none";
      app.setting.open();
    });
    const settingsPage = await popup;
    settingsPage.setDefaultTimeout(10000);
    if (settingsPage !== page) {
      settingsPage.on("pageerror", (error) => errors.push(error.message));
    }
    if (settingsPage !== page && process.env.CODE_TAB_SHOW_TEST_WINDOW !== "1") {
      await page.evaluate(() => {
        const testWindow = app.setting.popout.win.require("@electron/remote").getCurrentWindow();
        testWindow.webContents.setBackgroundThrottling(false);
        testWindow.hide();
      });
    }
    await page.evaluate(() => app.setting.openTabById("obsidian-code-tab"));
    const input = settingsPage.getByTestId("code-tab-completion-config");
    const save = settingsPage.getByTestId("code-tab-completion-config-save");
    const configuration = {
      wordLists: [
        {
          id: "persisted",
          languages: ["shell"],
          words: ["persistedCommand"],
        },
      ],
      rules: [
        {
          id: "persisted-rule",
          languages: ["shell"],
          match: "docker\\s+\\w*$",
          words: ["persistedCompose"],
        },
      ],
    };
    await input.fill(JSON.stringify(configuration));
    await save.click();
    await page.waitForFunction(
      () =>
        app.plugins.plugins["obsidian-code-tab"].completionConfiguration.wordLists[0]?.id ===
        "persisted",
    );
    const stored = JSON.parse(
      await readFile(join(vault, ".obsidian/plugins/obsidian-code-tab/data.json"), "utf8"),
    );
    const normalized = {
      wordLists: [
        {
          id: "persisted",
          languages: ["shell"],
          words: [
            {
              label: "persistedCommand",
            },
          ],
        },
      ],
      rules: [
        {
          id: "persisted-rule",
          languages: ["shell"],
          words: [
            {
              label: "persistedCompose",
            },
          ],
          match: "docker\\s+\\w*$",
          flags: "",
        },
      ],
    };
    assert.deepEqual(stored.completion, normalized);
    const revision = await page.evaluate(() => window.codeTabApi.completion.getRevision());
    await input.fill('{"rules":[{"id":"invalid","languages":["shell"],"words":[],"match":"["}]}');
    await save.click();
    await settingsPage.waitForFunction(
      () => !document.querySelector('[data-testid="code-tab-completion-config-save"]').disabled,
    );
    assert.equal(await page.evaluate(() => window.codeTabApi.completion.getRevision()), revision);
    await page.evaluate(async () => {
      app.setting.close();
      await app.plugins.disablePlugin("obsidian-code-tab");
      try {
        window.primary.handle.getSnapshot();
        throw new Error("卸载未释放句柄");
      } catch (error) {
        if (error.code !== window.codeTabApi.errorCodes.Disposed) {
          throw error;
        }
      }
      await app.plugins.enablePlugin("obsidian-code-tab");
      const request = {};
      document.dispatchEvent(
        new CustomEvent("obsidian-code-tab-api", {
          detail: request,
        }),
      );
      if (!request.api || request.api === window.codeTabApi) {
        throw new Error("发现 API 未刷新");
      }
      window.codeTabApi = request.api;
      const context = {
        documentId: "persisted",
        revision: 0,
        text: "pers",
        offset: 4,
        language: "sh",
        trigger: "automatic",
      };
      const result = await window.codeTabApi.completion.complete(context);
      if (!result.items.some((item) => item.label === "persistedCommand")) {
        throw new Error("词表未恢复");
      }
      const ruleContext = {
        ...context,
        text: "docker pers",
        offset: 11,
      };
      const ruleResult = await window.codeTabApi.completion.complete(ruleContext);
      if (!ruleResult.items.some((item) => item.label === "persistedCompose")) {
        throw new Error("规则未恢复");
      }
    });
  });

  await page.screenshot({
    path: join(directory, "openapi-completion.png"),
  });
  assert.equal(
    await readFile(join(vault, "Test.md"), "utf8"),
    initial,
    "宿主 API 不自行改写源文件",
  );
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
  console.log(`OpenAPI and completion: ${reports.length} scenarios passed`);
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
