import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { ExcalidrawFrame } from "./excalidrawFrame";

const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";

interface ExcalidrawScene {
  elements: ExcalidrawFrame[];
}

interface ExcalidrawApiCandidate {
  isExcalidrawFile?: (file: TFile) => boolean;
  getSceneFromFile?: (file: TFile) => Promise<ExcalidrawScene>;
}

interface ExcalidrawPluginCandidate extends ExcalidrawApiCandidate {
  ea?: ExcalidrawApiCandidate;
  getEA?: () => ExcalidrawApiCandidate;
}

interface AppWithPlugins extends App {
  plugins?: {
    getPlugin(id: string): unknown;
  };
}

export interface ExcalidrawSceneSource {
  file: TFile;
  getElements(): Promise<ExcalidrawFrame[]>;
}

/**
 * 将 Excalidraw 的可选、非公开插件入口收敛成 Code Tab 使用的最小能力。
 *
 * 不同版本可能把 ExcalidrawAutomate 暴露为 `ea`、`getEA()` 或插件自身；
 * 兼容变化应只修改此文件，Frame Deck 不感知插件对象的实际形状。
 */
export function resolveExcalidrawSceneSource(
  app: App,
  linkPath: string,
  sourcePath: string,
): ExcalidrawSceneSource | null {
  const plugin = (app as AppWithPlugins).plugins?.getPlugin(EXCALIDRAW_PLUGIN_ID) as
    ExcalidrawPluginCandidate | undefined;
  if (!plugin) {
    return null;
  }

  const automate = plugin.ea ?? plugin.getEA?.() ?? plugin;
  const fileOwner = automate.isExcalidrawFile ? automate : plugin;
  const sceneOwner = automate.getSceneFromFile ? automate : plugin;
  if (!fileOwner.isExcalidrawFile || !sceneOwner.getSceneFromFile) {
    return null;
  }

  const file = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
  if (!(file instanceof TFile) || !fileOwner.isExcalidrawFile.call(fileOwner, file)) {
    return null;
  }

  return {
    file,
    getElements: async () => {
      const scene = await sceneOwner.getSceneFromFile!.call(sceneOwner, file);
      return scene.elements;
    },
  };
}
