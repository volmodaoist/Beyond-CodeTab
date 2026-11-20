import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  stdin: {
    contents:
      'export {EditorState, Transaction} from "@codemirror/state"; export {history, undo, redo} from "@codemirror/commands"; export {fencePairingExtension} from "./src/components/CodeBlockEditor/fencePairing";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { EditorState, Transaction, history, undo, redo, fencePairingExtension } = await import(
  "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64")
);

function editor(doc) {
  return EditorState.create({
    doc,
    extensions: [fencePairingExtension()],
  });
}

test("三反引号改四反引号，结束围栏同事务修改且光标留在开头", () => {
  const state = editor("```python\nprint(1)\n```");
  const transaction = state.update({
    changes: {
      from: 3,
      insert: "`",
    },
    selection: {
      anchor: 4,
    },
  });
  assert.equal(transaction.newDoc.toString(), "````python\nprint(1)\n````");
  assert.equal(transaction.newSelection.main.head, 4);
  const reduced = transaction.state.update({
    changes: {
      from: 3,
      to: 4,
    },
    selection: {
      anchor: 3,
    },
  });
  assert.equal(reduced.newDoc.toString(), state.doc.toString());
});

test("从结束围栏修改时，开头同步并正确映射正文后光标", () => {
  const state = editor("```python\n正文\n```");
  const end = state.doc.length;
  const transaction = state.update({
    changes: {
      from: end,
      insert: "`",
    },
    selection: {
      anchor: end + 1,
    },
  });
  assert.equal(transaction.newDoc.toString(), "````python\n正文\n````");
  assert.equal(transaction.newSelection.main.head, end + 2);
});

test("外层围栏编辑保留内部代码块，多个普通代码块分别配对", () => {
  const state = editor("````tab\ntab: Python\n```python\nx\n```\n````\n\n```js\ny\n```");
  const transaction = state.update({
    changes: {
      from: 4,
      insert: "`",
    },
  });
  assert.equal(
    transaction.newDoc.toString(),
    "`````tab\ntab: Python\n```python\nx\n```\n`````\n\n```js\ny\n```",
  );
});

test("正文、语言和未配对围栏不触发长度同步", () => {
  const state = editor("```python\n正文\n````");
  assert.equal(
    state
      .update({
        changes: {
          from: 3,
          insert: "3",
        },
      })
      .newDoc.toString(),
    "```3python\n正文\n````",
  );
  assert.equal(
    editor("```python")
      .update({
        changes: {
          from: 3,
          insert: "`",
        },
      })
      .newDoc.toString(),
    "````python",
  );
});

test("撤销、远程同步与同时编辑两端时不再次生成伴随修改", () => {
  const state = editor("````\nbody\n````");
  const transaction = state.update({
    changes: {
      from: 3,
      to: 4,
    },
    annotations: Transaction.userEvent.of("undo"),
  });
  assert.equal(transaction.newDoc.toString(), "```\nbody\n````");
  const remote = state.update({
    changes: {
      from: 3,
      to: 4,
    },
    annotations: Transaction.remote.of(true),
  });
  assert.equal(remote.newDoc.toString(), transaction.newDoc.toString());
});

test("带缩进的波浪围栏支持双向长度同步", () => {
  const state = editor("  ~~~python\nx\n ~~~");
  assert.equal(
    state
      .update({
        changes: {
          from: 5,
          insert: "~",
        },
      })
      .newDoc.toString(),
    "  ~~~~python\nx\n ~~~~",
  );
});

test("粘贴四反引号后回车也生成同长度结束围栏，光标保留在正文", () => {
  const state = editor("````python");
  const offset = state.doc.length;
  const transaction = state.update({
    changes: {
      from: offset,
      insert: "\n",
    },
    selection: {
      anchor: offset + 1,
    },
  });
  assert.equal(transaction.newDoc.toString(), "````python\n\n````");
  assert.equal(transaction.newSelection.main.head, offset + 1);
  assert.equal(
    editor("段落")
      .update({
        changes: {
          from: 2,
          insert: "\n",
        },
      })
      .newDoc.toString(),
    "段落\n",
  );
});

test("连续输入和删除围栏的两端同步作为独立撤销步骤", () => {
  let state = EditorState.create({
    doc: "```python\nx\n```",
    extensions: [fencePairingExtension(), history()],
  });
  state = state.update({
    changes: {
      from: 3,
      insert: "`",
    },
    selection: {
      anchor: 4,
    },
    annotations: Transaction.userEvent.of("input.type"),
  }).state;
  state = state.update({
    changes: {
      from: 3,
      to: 4,
    },
    selection: {
      anchor: 3,
    },
    annotations: Transaction.userEvent.of("delete.backward"),
  }).state;
  const dispatch = (transaction) => {
    state = transaction.state;
  };
  assert.equal(
    undo({
      state,
      dispatch,
    }),
    true,
  );
  assert.equal(state.doc.toString(), "````python\nx\n````");
  assert.equal(
    redo({
      state,
      dispatch,
    }),
    true,
  );
  assert.equal(state.doc.toString(), "```python\nx\n```");
});

test("已有结束围栏、外层块内的围栏和无效语言行回车不补出额外围栏", () => {
  for (const doc of [
    "```python\nx\n```",
    "````tab\ntab: Python\n```python\nx\n```\n````",
    "```py`invalid",
  ]) {
    const state = editor(doc);
    const position = doc.includes("tab:") ? doc.indexOf("```\n````") + 3 : doc.length;
    const transaction = state.update({
      changes: {
        from: position,
        insert: "\n",
      },
    });
    assert.equal(
      transaction.newDoc.toString(),
      doc.slice(0, position) + "\n" + doc.slice(position),
    );
  }
});
