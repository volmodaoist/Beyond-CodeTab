/** 判断预览中的点击应该进入编辑态，还是继续交给嵌入或交互控件。 */
export function previewTargetStartsEditing(target: Element): boolean {
  if (target.closest(".internal-embed, .excalidraw-svg, .excalidraw-embedded-img")) {
    return false;
  }
  // Obsidian 附加在代码块上的源码按钮是例外：其仍然用于进入 Code Tab 编辑态。
  if (target.closest("pre button")) {
    return true;
  }
  return !target.closest("a, button, input, textarea, select");
}

/** 在销毁预览前，以被点击块的文本为锚点寻找对应的 Markdown 源文位置。 */
export function findPreviewSourcePosition(
  panel: HTMLElement,
  target: Element,
  source: string,
): number | null {
  const candidates: string[] = [];
  for (
    let element: Element | null = target;
    element && element !== panel;
    element = element.parentElement
  ) {
    const text = element.textContent?.trim();
    if (!text) {
      continue;
    }
    candidates.push(text);
    // 内联 Markdown 会在源文中插入标记，导致整段渲染文本无法直接匹配。
    // 同时尝试较长的连续文本片段，仍能把光标放到被点击语句附近。
    candidates.push(
      ...text
        .split(/[\s，。；：、,.!?！？()[\]{}<>`*_~|]+/u)
        .filter((part) => part.length >= 2)
        .sort((left, right) => right.length - left.length),
    );
  }

  const panelBounds = panel.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const relativeOffset = Math.max(0, targetBounds.top - panelBounds.top);
  const relativePosition = Math.min(1, relativeOffset / Math.max(panel.clientHeight, 1));
  const expected = source.length * relativePosition;
  let result: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    for (
      let index = source.indexOf(candidate);
      index >= 0;
      index = source.indexOf(candidate, index + 1)
    ) {
      const nextDistance = Math.abs(index - expected);
      if (nextDistance < distance) {
        result = index;
        distance = nextDistance;
      }
    }
  }
  return result;
}
