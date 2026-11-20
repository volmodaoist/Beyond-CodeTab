import { EditorState, Transaction } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import type { ChangeSpec, Extension, Text, TransactionSpec } from "@codemirror/state";

interface FenceMark {
  from: number;
  to: number;
  marker: string;
  length: number;
  suffix: string;
}

interface FencePair {
  opening: FenceMark;
  closing: FenceMark;
}

function markAt(doc: Text, offset: number): FenceMark | null {
  const line = doc.lineAt(Math.min(offset, doc.length));
  const match = line.text.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!match) {
    return null;
  }
  const mark: FenceMark = {
    from: line.from + match[1].length,
    to: line.from + match[1].length + match[2].length,
    marker: match[2][0],
    length: match[2].length,
    suffix: match[3],
  };
  return mark;
}

function pairsOf(doc: Text): FencePair[] {
  const pairs: FencePair[] = [];
  let opening: FenceMark | null = null;
  for (let index = 1; index <= doc.lines; index += 1) {
    const mark = markAt(doc, doc.line(index).from);
    if (!mark) {
      continue;
    }
    if (!opening) {
      if (mark.marker !== "`" || !mark.suffix.includes("`")) {
        opening = mark;
      }
    } else if (
      mark.marker === opening.marker &&
      mark.length >= opening.length &&
      !mark.suffix.trim()
    ) {
      const pair: FencePair = {
        opening,
        closing: mark,
      };
      pairs.push(pair);
      opening = null;
    }
  }
  return pairs;
}

/** 在原生三反引号补全上同步已有围栏；不改写代码正文或未配对文本。 */
export function fencePairingExtension(): Extension {
  return EditorState.transactionFilter.of((transaction) => {
    if (
      !transaction.docChanged ||
      transaction.isUserEvent("undo") ||
      transaction.isUserEvent("redo") ||
      transaction.annotation(Transaction.remote)
    ) {
      return transaction;
    }
    let markEdit = false;
    let enterAt: number | null = null;
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      const removed = transaction.startState.doc.sliceString(from, to);
      const text = inserted.toString();
      if (/^[`~]*$/.test(text) && /^[`~]*$/.test(removed) && (text || removed)) {
        markEdit ||= !!markAt(transaction.startState.doc, from);
      }
      const line = transaction.startState.doc.lineAt(from);
      if (
        from === to &&
        from === line.to &&
        /^\n[ \t]*$/.test(text) &&
        markAt(transaction.startState.doc, from)
      ) {
        enterAt = from;
      }
    });
    if (!markEdit && enterAt === null) {
      return transaction;
    }
    const changes: ChangeSpec[] = [];
    const pairs = pairsOf(transaction.startState.doc);
    let keepCaret = false;
    if (enterAt !== null && transaction.startState.selection.ranges.length === 1) {
      const mark = markAt(transaction.startState.doc, enterAt);
      if (
        mark &&
        (mark.marker !== "`" || !mark.suffix.includes("`")) &&
        !pairs.some((pair) => mark.from >= pair.opening.from && mark.from <= pair.closing.from)
      ) {
        const position = transaction.changes.mapPos(enterAt, 1);
        const line = transaction.startState.doc.lineAt(enterAt);
        const indent = line.text.slice(0, mark.from - line.from);
        const closing: ChangeSpec = {
          from: position,
          insert: "\n" + indent + mark.marker.repeat(mark.length),
        };
        changes.push(closing);
        keepCaret = true;
      }
    }
    for (const pair of pairs) {
      for (const [changed, companion] of [
        [pair.opening, pair.closing],
        [pair.closing, pair.opening],
      ]) {
        let touched = false;
        let onlyMarks = true;
        let companionTouched = false;
        transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
          if (from <= companion.to && to >= companion.from) {
            companionTouched = true;
          }
          if (from <= changed.to && to >= changed.from) {
            touched = true;
            if (
              from < changed.from ||
              to > changed.to ||
              [...inserted.toString()].some((character) => character !== changed.marker)
            ) {
              onlyMarks = false;
            }
          }
        });
        if (!touched || !onlyMarks || companionTouched) {
          continue;
        }
        const next = markAt(transaction.newDoc, transaction.changes.mapPos(changed.from, -1));
        if (!next || next.marker !== changed.marker || next.length === changed.length) {
          continue;
        }
        const update: ChangeSpec = {
          from: transaction.changes.mapPos(companion.from, -1),
          to: transaction.changes.mapPos(companion.to, 1),
          insert: changed.marker.repeat(next.length),
        };
        changes.push(update);
      }
    }
    if (!changes.length) {
      return transaction;
    }
    const correction: TransactionSpec = {
      changes,
      sequential: true,
      selection: keepCaret ? transaction.newSelection : undefined,
      annotations: isolateHistory.of("full"),
    };
    return [transaction, correction];
  });
}
