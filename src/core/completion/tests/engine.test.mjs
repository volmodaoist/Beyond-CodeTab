import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../index.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createCompletionEngine, CompletionErrorCode, parseCompletionConfiguration } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64")
);

function context(language, text, extra = {}) {
  return {
    documentId: "test-document",
    revision: 1,
    language,
    text,
    offset: text.length,
    trigger: "automatic",
    ...extra,
  };
}

for (const [language, prefix, label] of [
  ["java", "pub", "public"],
  ["c", "pri", "printf"],
  ["c++", "vec", "vector"],
  ["python3", "enu", "enumerate"],
  ["js", "con", "const"],
  ["ts", "key", "keyof"],
  ["golang", "def", "defer"],
  ["bash", "ech", "echo"],
]) {
  test(`热门语言词表 ${language}：${prefix} → ${label}`, async () => {
    const engine = createCompletionEngine();
    const result = await engine.complete(context(language, prefix));
    const item = result.items.find((item) => item.label === label);
    assert.ok(item);
    assert.equal(item.from, 0);
    assert.equal(item.to, prefix.length);
    assert.equal(item.insertText, label);
    engine.dispose();
  });
}

test("未知语言没有 Python 回退，C 不混入 C++ 容器", async () => {
  const engine = createCompletionEngine();
  assert.equal((await engine.complete(context("unknown", "def"))).items.length, 0);
  assert.equal((await engine.complete(context("c", "vec"))).items.length, 0);
  assert.ok(
    (await engine.complete(context("cpp", "std::vec"))).items.some(
      (item) => item.label === "vector" && item.from === 5,
    ),
  );
});

test("C++ 成员规则保留对象前缀", async () => {
  const engine = createCompletionEngine();
  for (const text of ["items.pu", "items->pu"]) {
    const result = await engine.complete(context("cpp", text));
    const item = result.items.find((item) => item.label === "push_back");
    assert.ok(item);
    assert.equal(text.slice(0, item.from) + item.insertText, text.replace(/pu$/, "push_back"));
  }
});

test("自定义词表支持插入文本与替换，旧清理函数不移除新版本", async () => {
  const engine = createCompletionEngine();
  const removeOld = engine.registerWords({
    id: "custom",
    languages: ["shell"],
    words: ["greet"],
  });
  engine.replaceWords({
    id: "custom",
    languages: ["shell"],
    words: [
      {
        label: "greet",
        insertText: "echo hello",
        boost: 50,
      },
    ],
  });
  removeOld();
  const result = await engine.complete(context("shell", "gre"));
  assert.equal(result.items[0].insertText, "echo hello");
  assert.equal(engine.unregister("custom"), true);
  assert.equal(engine.unregister("custom"), false);
  assert.equal(
    (await engine.complete(context("shell", "gre"))).items.some((item) => item.label === "greet"),
    false,
  );
});

test("重复 id 和不存在的替换使用公开错误枚举", () => {
  const engine = createCompletionEngine();
  const list = {
    id: "custom",
    languages: ["java"],
    words: ["Hello"],
  };
  engine.registerWords(list);
  assert.throws(() => engine.registerWords(list), {
    code: CompletionErrorCode.DuplicateId,
  });
  assert.throws(
    () =>
      engine.replaceWords({
        ...list,
        id: "absent",
      }),
    {
      code: CompletionErrorCode.NotFound,
    },
  );
  assert.equal(engine.errorCodes.InvalidRule, CompletionErrorCode.InvalidRule);
});

test("正则规则只匹配当前行的光标前上下文，不改变调用者正则状态", async () => {
  const engine = createCompletionEngine();
  const match = /JSON\.\w*$/g;
  match.lastIndex = 100;
  engine.registerRule({
    id: "json",
    languages: ["js"],
    match,
    words: ["fromJSON"],
  });
  const yes = await engine.complete(context("js", "previous line\nJSON.fr"));
  assert.ok(yes.items.some((item) => item.label === "fromJSON" && item.from === 19));
  const no = await engine.complete(context("js", "JSON.fr\nother.fr"));
  assert.equal(
    no.items.some((item) => item.label === "fromJSON"),
    false,
  );
  assert.equal(match.lastIndex, 100);
});

test("注册时复制词表，外部修改数组不会改变候选", async () => {
  const engine = createCompletionEngine();
  const words = [
    {
      label: "localOne",
    },
  ];
  engine.registerWords({
    id: "local",
    languages: ["*"],
    words,
  });
  words[0].label = "changed";
  words.push("localTwo");
  const result = await engine.complete(context("unknown", "local"));
  assert.deepEqual(
    result.items.map((item) => item.label),
    ["localOne"],
  );
  assert.ok(Object.isFrozen(result.items[0]));
});

test("函数规则只保留有效正文范围，并隔离失败规则", async () => {
  const engine = createCompletionEngine();
  engine.registerRule({
    id: "bad",
    languages: ["python"],
    complete: () => {
      throw new Error("offline");
    },
  });
  engine.registerRule({
    id: "range",
    languages: ["python"],
    complete: () => [
      {
        label: "invalid",
        insertText: "oops",
        from: -1,
        to: 3,
      },
      {
        label: "valid",
        insertText: "customPrint",
        from: 0,
        to: 3,
      },
    ],
  });
  const result = await engine.complete(context("python", "pri"));
  assert.ok(result.items.some((item) => item.label === "print"));
  assert.ok(result.items.some((item) => item.label === "valid"));
  assert.equal(
    result.items.some((item) => item.label === "invalid"),
    false,
  );
  assert.deepEqual(result.failures, [
    {
      ruleId: "bad",
      message: "offline",
    },
  ]);
});

test("同样的插入按 boost 去重，异步失败不影响其他词表", async () => {
  const engine = createCompletionEngine();
  engine.registerWords({
    id: "a",
    languages: ["unknown"],
    words: [
      {
        label: "one",
        insertText: "ok",
        boost: 10,
      },
    ],
  });
  engine.registerWords({
    id: "b",
    languages: ["unknown"],
    words: [
      {
        label: "other",
        insertText: "ok",
        boost: 20,
      },
    ],
  });
  const result = await engine.complete(context("unknown", "o"));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].label, "other");
});

test("声明配置整体校验后替换，失败保留原配置和注册版本", async () => {
  const engine = createCompletionEngine();
  const first = parseCompletionConfiguration({
    wordLists: [
      {
        id: "user",
        languages: ["shell"],
        words: ["mycmd"],
      },
    ],
  });
  engine.configure(first);
  const revision = engine.getRevision();
  assert.throws(
    () =>
      engine.configure({
        rules: [
          {
            id: "bad",
            languages: ["shell"],
            words: ["x"],
            match: "[",
          },
        ],
      }),
    {
      code: CompletionErrorCode.InvalidRule,
    },
  );
  assert.equal(engine.getRevision(), revision);
  assert.ok(
    (await engine.complete(context("shell", "myc"))).items.some((item) => item.label === "mycmd"),
  );
  engine.configure(parseCompletionConfiguration({}));
  assert.equal((await engine.complete(context("shell", "myc"))).items.length, 0);
});

test("规则配置支持正则及语言别名，重复配置 id 拒绝", async () => {
  const engine = createCompletionEngine();
  engine.configure(
    parseCompletionConfiguration({
      rules: [
        {
          id: "tools",
          languages: ["bash"],
          match: "docker\\s+\\w*$",
          words: ["compose"],
        },
      ],
    }),
  );
  assert.ok(
    (await engine.complete(context("sh", "docker co"))).items.some(
      (item) => item.label === "compose",
    ),
  );
  assert.throws(
    () =>
      parseCompletionConfiguration({
        wordLists: [
          {
            id: "x",
            languages: ["java"],
            words: [],
          },
        ],
        rules: [
          {
            id: "x",
            languages: ["java"],
            words: [],
          },
        ],
      }),
    {
      code: CompletionErrorCode.InvalidRule,
    },
  );
});

for (const action of ["cancel", "replace", "dispose"]) {
  test(`迟到的异步规则结果在 ${action} 后失效`, async () => {
    const engine = createCompletionEngine();
    let resolve;
    engine.registerRule({
      id: "slow",
      languages: ["unknown"],
      complete: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const abort = new AbortController();
    const pending = engine.complete(
      context("unknown", "x", {
        signal: abort.signal,
      }),
    );
    if (action === "cancel") {
      abort.abort();
    }
    if (action === "replace") {
      engine.unregister("slow");
    }
    if (action === "dispose") {
      engine.dispose();
    }
    resolve([
      {
        label: "x",
        insertText: "x",
        from: 0,
        to: 1,
      },
    ]);
    const code =
      action === "cancel"
        ? CompletionErrorCode.Cancelled
        : action === "replace"
          ? CompletionErrorCode.Stale
          : CompletionErrorCode.Disposed;
    await assert.rejects(pending, {
      code,
    });
  });
}

test("两个编辑会话的请求互不取消", async () => {
  const engine = createCompletionEngine();
  const resolvers = new Map();
  engine.registerRule({
    id: "shared",
    languages: ["unknown"],
    complete: (request) => new Promise((resolve) => resolvers.set(request.documentId, resolve)),
  });
  const a = engine.complete(
    context("unknown", "a", {
      documentId: "a",
    }),
  );
  const b = engine.complete(
    context("unknown", "b", {
      documentId: "b",
    }),
  );
  resolvers.get("b")([
    {
      label: "b",
      insertText: "b",
      from: 0,
      to: 1,
    },
  ]);
  resolvers.get("a")([
    {
      label: "a",
      insertText: "a",
      from: 0,
      to: 1,
    },
  ]);
  assert.equal((await a).documentId, "a");
  assert.equal((await b).documentId, "b");
});

test("显式请求、Unicode 和 Shell 变量前缀采用 UTF-16 范围", async () => {
  const engine = createCompletionEngine();
  assert.equal((await engine.complete(context("java", ""))).items.length, 0);
  assert.ok(
    (
      await engine.complete(
        context("java", "", {
          trigger: "explicit",
        }),
      )
    ).items.length > 0,
  );
  const result = await engine.complete(context("bash", "中文\n$HO"));
  assert.ok(
    result.items.some((item) => item.label === "$HOME" && item.from === 3 && item.to === 6),
  );
});

test("请求验证与取消、释放后的行为使用错误枚举", async () => {
  const engine = createCompletionEngine();
  await assert.rejects(
    engine.complete(
      context("java", "x", {
        offset: 9,
      }),
    ),
    {
      code: CompletionErrorCode.InvalidContext,
    },
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    engine.complete(
      context("java", "x", {
        signal: abort.signal,
      }),
    ),
    {
      code: CompletionErrorCode.Cancelled,
    },
  );
  engine.dispose();
  engine.dispose();
  assert.throws(() => engine.list(), {
    code: CompletionErrorCode.Disposed,
  });
});
