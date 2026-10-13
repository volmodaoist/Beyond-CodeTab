export interface ExcalidrawEmbed {
  linkPath: string;
  suffix: string;
}

export interface ExcalidrawFrame {
  id: string;
  type: string;
  isDeleted?: boolean;
  name?: string | null;
  x: number;
  y: number;
  customData?: {
    slideshow?: {
      order?: unknown;
    };
  };
}

const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Frame Deck 只接管正文中唯一、且没有指定子区域的 Obsidian 嵌入。 */
export function parseSingleExcalidrawEmbed(source: string): ExcalidrawEmbed | null {
  const match = /^\s*!\[\[([^\]]+)\]\]\s*$/.exec(source);
  if (!match) {
    return null;
  }

  const inner = match[1];
  const separator = inner.indexOf("|");
  const linkPath = (separator < 0 ? inner : inner.slice(0, separator)).trim();
  if (!linkPath || linkPath.includes("#")) {
    return null;
  }

  const suffix = separator < 0 ? "" : inner.slice(separator);
  return {
    linkPath,
    suffix,
  };
}

function slideshowOrder(frame: ExcalidrawFrame): number | null {
  const value = frame.customData?.slideshow?.order;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 先尊重幻灯片显式顺序，再按名称、画布位置和 ID 给出稳定的自然顺序。 */
export function sortExcalidrawFrames(elements: readonly ExcalidrawFrame[]): ExcalidrawFrame[] {
  return elements
    .filter((element) => element.type === "frame" && !element.isDeleted)
    .slice()
    .sort((left, right) => {
      const leftOrder = slideshowOrder(left);
      const rightOrder = slideshowOrder(right);
      if (leftOrder !== null || rightOrder !== null) {
        if (leftOrder === null) {
          return 1;
        }
        if (rightOrder === null) {
          return -1;
        }
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
      }

      const leftName = left.name?.trim() ?? "";
      const rightName = right.name?.trim() ?? "";
      if (leftName || rightName) {
        if (!leftName) {
          return 1;
        }
        if (!rightName) {
          return -1;
        }
        const nameComparison = naturalNameCollator.compare(leftName, rightName);
        if (nameComparison !== 0) {
          return nameComparison;
        }
      }

      if (left.y !== right.y) {
        return left.y - right.y;
      }
      if (left.x !== right.x) {
        return left.x - right.x;
      }
      return left.id.localeCompare(right.id);
    });
}

export function buildExcalidrawFrameEmbed(embed: ExcalidrawEmbed, frameId: string): string {
  return "![[" + embed.linkPath + "#^frame=" + frameId + embed.suffix + "]]";
}
