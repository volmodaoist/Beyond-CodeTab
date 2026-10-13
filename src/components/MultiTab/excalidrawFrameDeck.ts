import { Component, MarkdownRenderer, setIcon, TFile } from "obsidian";
import type { App } from "obsidian";
import {
  buildExcalidrawFrameEmbed,
  parseSingleExcalidrawEmbed,
  sortExcalidrawFrames,
} from "./excalidrawFrame";
import type { ExcalidrawEmbed, ExcalidrawFrame } from "./excalidrawFrame";

const EXCALIDRAW_PLUGIN_ID = "obsidian-excalidraw-plugin";
const ANIMATION_DURATION = 220;
const FILE_REFRESH_DELAY = 160;

interface ExcalidrawScene {
  elements: ExcalidrawFrame[];
}

interface ExcalidrawApi {
  isExcalidrawFile(file: TFile): boolean;
  getSceneFromFile(file: TFile): Promise<ExcalidrawScene>;
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

interface RenderedPage {
  element: HTMLDivElement;
  component: Component;
}

export interface ExcalidrawFrameDeckOptions {
  app: App;
  panel: HTMLElement;
  sourcePath: string;
  source: string;
  stateKeyPrefix: string;
  activeFrames: Map<string, string>;
}

function getExcalidrawApi(app: App): ExcalidrawApi | null {
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

  return {
    isExcalidrawFile: (file) => Boolean(fileOwner.isExcalidrawFile?.call(fileOwner, file)),
    getSceneFromFile: (file) => sceneOwner.getSceneFromFile!.call(sceneOwner, file),
  };
}

export class ExcalidrawFrameDeck extends Component {
  private readonly options: ExcalidrawFrameDeckOptions;
  private readonly embed: ExcalidrawEmbed;
  private readonly file: TFile;
  private readonly api: ExcalidrawApi;
  private readonly stateKey: string;
  private frames: ExcalidrawFrame[] = [];
  private currentFrameId: string | null = null;
  private currentPage: RenderedPage | null = null;
  private root: HTMLDivElement | null = null;
  private viewport: HTMLDivElement | null = null;
  private controls: HTMLDivElement | null = null;
  private previousButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private counter: HTMLSpanElement | null = null;
  private moving = false;
  private refreshTimer: number | null = null;
  private animationTimer: number | null = null;

  private constructor(
    options: ExcalidrawFrameDeckOptions,
    embed: ExcalidrawEmbed,
    file: TFile,
    api: ExcalidrawApi,
  ) {
    super();
    this.options = options;
    this.embed = embed;
    this.file = file;
    this.api = api;
    this.stateKey = options.stateKeyPrefix + ":" + file.path;
  }

  static async create(options: ExcalidrawFrameDeckOptions): Promise<ExcalidrawFrameDeck | null> {
    const embed = parseSingleExcalidrawEmbed(options.source);
    if (!embed) {
      return null;
    }

    try {
      const api = getExcalidrawApi(options.app);
      if (!api) {
        return null;
      }
      const file = options.app.metadataCache.getFirstLinkpathDest(
        embed.linkPath,
        options.sourcePath,
      );
      if (!(file instanceof TFile) || !api.isExcalidrawFile(file)) {
        return null;
      }
      const scene = await api.getSceneFromFile(file);
      const frames = sortExcalidrawFrames(scene.elements);
      if (frames.length < 2) {
        return null;
      }

      const deck = new ExcalidrawFrameDeck(options, embed, file, api);
      deck.frames = frames;
      return deck;
    } catch (error) {
      console.warn("Code Tab: could not initialize Excalidraw Frame Deck", error);
      return null;
    }
  }

  async initialize(): Promise<void> {
    this.createElements();
    const rememberedFrame = this.options.activeFrames.get(this.stateKey);
    const initialFrame =
      this.frames.find((frame) => frame.id === rememberedFrame) ?? this.frames[0];
    await this.replaceCurrent(buildExcalidrawFrameEmbed(this.embed, initialFrame.id));
    this.setCurrentFrame(initialFrame.id);

    this.registerEvent(
      this.options.app.vault.on("modify", (file) => {
        if (file.path === this.file.path) {
          this.scheduleRefresh();
        }
      }),
    );
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    if (this.animationTimer !== null) {
      window.clearTimeout(this.animationTimer);
    }
    this.root?.remove();
  }

  private createElements(): void {
    const root = document.createElement("div");
    root.className = "code-tab__frame-deck";
    root.setAttribute("data-testid", "code-tab-frame-deck");

    const controls = document.createElement("div");
    controls.className = "code-tab__frame-controls";
    controls.setAttribute("aria-label", "Excalidraw 画板翻页");
    root.appendChild(controls);

    const previousButton = document.createElement("button");
    previousButton.className = "code-tab__frame-button";
    previousButton.type = "button";
    previousButton.title = "上一页";
    previousButton.setAttribute("aria-label", "上一页");
    setIcon(previousButton, "chevron-left");
    controls.appendChild(previousButton);

    const counter = document.createElement("span");
    counter.className = "code-tab__frame-counter";
    counter.setAttribute("aria-live", "polite");
    controls.appendChild(counter);

    const nextButton = document.createElement("button");
    nextButton.className = "code-tab__frame-button";
    nextButton.type = "button";
    nextButton.title = "下一页";
    nextButton.setAttribute("aria-label", "下一页");
    setIcon(nextButton, "chevron-right");
    controls.appendChild(nextButton);

    const viewport = document.createElement("div");
    viewport.className = "code-tab__frame-viewport";
    root.appendChild(viewport);
    this.options.panel.appendChild(root);

    this.root = root;
    this.controls = controls;
    this.previousButton = previousButton;
    this.nextButton = nextButton;
    this.counter = counter;
    this.viewport = viewport;
    this.registerDomEvent(previousButton, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.move(-1);
    });
    this.registerDomEvent(nextButton, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.move(1);
    });
  }

  private async renderPage(source: string, initialClass?: string): Promise<RenderedPage> {
    const element = document.createElement("div");
    element.className = "code-tab__frame-page";
    if (initialClass) {
      element.classList.add(initialClass);
    }
    element.setAttribute("data-testid", "code-tab-frame-page");
    this.viewport?.appendChild(element);
    const component = this.addChild(new Component());
    try {
      await MarkdownRenderer.render(
        this.options.app,
        source,
        element,
        this.options.sourcePath,
        component,
      );
      return {
        element,
        component,
      };
    } catch (error) {
      this.removeChild(component);
      element.remove();
      throw error;
    }
  }

  private releasePage(page: RenderedPage): void {
    this.removeChild(page.component);
    page.element.remove();
  }

  private async replaceCurrent(source: string): Promise<void> {
    const nextPage = await this.renderPage(source);
    const previousPage = this.currentPage;
    this.currentPage = nextPage;
    if (previousPage) {
      this.releasePage(previousPage);
    }
  }

  private setCurrentFrame(frameId: string): void {
    this.currentFrameId = frameId;
    this.options.activeFrames.set(this.stateKey, frameId);
    this.updateControls();
  }

  private updateControls(): void {
    const index = this.frames.findIndex((frame) => frame.id === this.currentFrameId);
    if (this.previousButton) {
      this.previousButton.disabled = this.moving || index < 0;
    }
    if (this.nextButton) {
      this.nextButton.disabled = this.moving || index < 0;
    }
    if (this.counter) {
      this.counter.textContent = index < 0 ? "– / –" : index + 1 + " / " + this.frames.length;
    }
  }

  private async move(direction: -1 | 1): Promise<void> {
    if (this.moving || !this.currentPage) {
      return;
    }
    const currentIndex = this.frames.findIndex((frame) => frame.id === this.currentFrameId);
    if (currentIndex < 0 || this.frames.length < 2) {
      return;
    }
    const targetIndex = (currentIndex + direction + this.frames.length) % this.frames.length;

    this.moving = true;
    this.updateControls();
    let incoming: RenderedPage | null = null;
    try {
      const target = this.frames[targetIndex];
      const enteringClass = direction > 0 ? "is-entering-right" : "is-entering-left";
      incoming = await this.renderPage(
        buildExcalidrawFrameEmbed(this.embed, target.id),
        enteringClass,
      );
      const outgoing = this.currentPage;
      outgoing.element.classList.add(direction > 0 ? "is-leaving-left" : "is-leaving-right");
      // 读取布局后再切换 class，确保浏览器把起始与结束状态分到两个绘制帧。
      void incoming.element.offsetWidth;
      incoming.element.classList.add("is-active");
      outgoing.element.classList.add("is-active");
      await this.waitForAnimation();
      incoming.element.classList.remove("is-entering-right", "is-entering-left", "is-active");
      this.releasePage(outgoing);
      this.currentPage = incoming;
      incoming = null;
      this.setCurrentFrame(target.id);
    } catch (error) {
      if (incoming) {
        this.releasePage(incoming);
      }
      console.warn("Code Tab: could not change Excalidraw frame", error);
    } finally {
      this.moving = false;
      this.updateControls();
    }
  }

  private waitForAnimation(): Promise<void> {
    return new Promise((resolve) => {
      this.animationTimer = window.setTimeout(() => {
        this.animationTimer = null;
        resolve();
      }, ANIMATION_DURATION + 40);
    });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshScene();
    }, FILE_REFRESH_DELAY);
  }

  private async refreshScene(): Promise<void> {
    if (this.moving) {
      this.scheduleRefresh();
      return;
    }

    try {
      const scene = await this.api.getSceneFromFile(this.file);
      const frames = sortExcalidrawFrames(scene.elements);
      this.frames = frames;
      if (frames.length < 2) {
        this.controls?.addClass("is-hidden");
        this.options.activeFrames.delete(this.stateKey);
        this.currentFrameId = null;
        await this.replaceCurrent(this.options.source);
        return;
      }

      this.controls?.removeClass("is-hidden");
      const currentFrame =
        frames.find((frame) => frame.id === this.currentFrameId) ?? frames[frames.length - 1];
      await this.replaceCurrent(buildExcalidrawFrameEmbed(this.embed, currentFrame.id));
      this.setCurrentFrame(currentFrame.id);
    } catch (error) {
      console.warn("Code Tab: could not refresh Excalidraw frames", error);
    }
  }
}
