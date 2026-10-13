import { Component, MarkdownRenderer, setIcon } from "obsidian";
import type { App } from "obsidian";
import {
  buildExcalidrawFrameEmbed,
  parseSingleExcalidrawEmbed,
  sortExcalidrawFrames,
} from "./excalidrawFrame";
import type { ExcalidrawEmbed, ExcalidrawFrame } from "./excalidrawFrame";
import { resolveExcalidrawSceneSource } from "./excalidrawApi";
import type { ExcalidrawSceneSource } from "./excalidrawApi";

const ANIMATION_DURATION = 220;
const FILE_REFRESH_DELAY = 160;

interface RenderedPage {
  element: HTMLDivElement;
  component: Component;
}

interface FrameDeckElements {
  root: HTMLDivElement;
  viewport: HTMLDivElement;
  controls: HTMLDivElement;
  previousButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  counter: HTMLSpanElement;
}

export interface ExcalidrawFrameDeckOptions {
  app: App;
  panel: HTMLElement;
  sourcePath: string;
  source: string;
  stateKeyPrefix: string;
  activeFrames: Map<string, string>;
}

export class ExcalidrawFrameDeck extends Component {
  private readonly options: ExcalidrawFrameDeckOptions;
  private readonly embed: ExcalidrawEmbed;
  private readonly sceneSource: ExcalidrawSceneSource;
  private readonly stateKey: string;
  private frames: ExcalidrawFrame[] = [];
  private currentFrameId: string | null = null;
  private currentPage: RenderedPage | null = null;
  private elements: FrameDeckElements | null = null;
  private moving = false;
  private refreshTimer: number | null = null;
  private animationTimer: number | null = null;
  private finishAnimation: (() => void) | null = null;
  private unloaded = false;

  private constructor(
    options: ExcalidrawFrameDeckOptions,
    embed: ExcalidrawEmbed,
    sceneSource: ExcalidrawSceneSource,
  ) {
    super();
    this.options = options;
    this.embed = embed;
    this.sceneSource = sceneSource;
    this.stateKey = options.stateKeyPrefix + ":" + sceneSource.file.path;
  }

  static async create(options: ExcalidrawFrameDeckOptions): Promise<ExcalidrawFrameDeck | null> {
    const embed = parseSingleExcalidrawEmbed(options.source);
    if (!embed) {
      return null;
    }

    try {
      // 工厂阶段只探测能力和读取 Frame，不创建 DOM。返回 null 后调用方可无痕走普通预览。
      const sceneSource = resolveExcalidrawSceneSource(
        options.app,
        embed.linkPath,
        options.sourcePath,
      );
      if (!sceneSource) {
        return null;
      }
      const frames = sortExcalidrawFrames(await sceneSource.getElements());
      if (frames.length < 2) {
        return null;
      }

      const deck = new ExcalidrawFrameDeck(options, embed, sceneSource);
      deck.frames = frames;
      return deck;
    } catch (error) {
      console.warn("Code Tab: could not initialize Excalidraw Frame Deck", error);
      return null;
    }
  }

  async initialize(): Promise<void> {
    // 组件被父预览 addChild 后才初始化，使页面 Component、DOM 事件和 Vault 监听共享同一生命周期。
    this.elements = this.createElements();
    const rememberedFrame = this.options.activeFrames.get(this.stateKey);
    const initialFrame =
      this.frames.find((frame) => frame.id === rememberedFrame) ?? this.frames[0];
    await this.replaceCurrent(buildExcalidrawFrameEmbed(this.embed, initialFrame.id));
    if (this.unloaded) {
      return;
    }
    this.setCurrentFrame(initialFrame.id);

    this.registerEvent(
      this.options.app.vault.on("modify", (file) => {
        if (file.path === this.sceneSource.file.path) {
          this.scheduleRefresh();
        }
      }),
    );
  }

  onunload(): void {
    this.unloaded = true;
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    // 解除仍在等待的动画 Promise，避免组件卸载后保留整棵预览 DOM 的闭包引用。
    this.finishAnimation?.();
    this.elements?.root.remove();
    this.elements = null;
  }

  private createElements(): FrameDeckElements {
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
    return {
      root,
      viewport,
      controls,
      previousButton,
      nextButton,
      counter,
    };
  }

  private async renderPage(source: string, initialClass?: string): Promise<RenderedPage> {
    const element = document.createElement("div");
    element.className = "code-tab__frame-page";
    if (initialClass) {
      element.classList.add(initialClass);
    }
    element.setAttribute("data-testid", "code-tab-frame-page");
    if (!this.elements) {
      throw new Error("Excalidraw Frame Deck has not been initialized");
    }
    this.elements.viewport.appendChild(element);
    // 每页使用独立子 Component；翻页完成后释放旧页时，第三方渲染器注册的资源也一并清理。
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
    if (!this.elements) {
      return;
    }
    const index = this.frames.findIndex((frame) => frame.id === this.currentFrameId);
    this.elements.previousButton.disabled = this.moving || index < 0;
    this.elements.nextButton.disabled = this.moving || index < 0;
    this.elements.counter.textContent =
      index < 0 ? "– / –" : index + 1 + " / " + this.frames.length;
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
      if (this.unloaded) {
        incoming = null;
        return;
      }
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
      const finish = () => {
        if (this.animationTimer !== null) {
          window.clearTimeout(this.animationTimer);
        }
        this.animationTimer = null;
        this.finishAnimation = null;
        resolve();
      };
      this.finishAnimation = finish;
      this.animationTimer = window.setTimeout(finish, ANIMATION_DURATION + 40);
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
      const previousIndex = this.frames.findIndex((frame) => frame.id === this.currentFrameId);
      const frames = sortExcalidrawFrames(await this.sceneSource.getElements());
      this.frames = frames;
      if (frames.length < 2) {
        this.elements?.controls.addClass("is-hidden");
        this.options.activeFrames.delete(this.stateKey);
        this.currentFrameId = null;
        await this.replaceCurrent(this.options.source);
        return;
      }

      this.elements?.controls.removeClass("is-hidden");
      const currentFrame =
        frames.find((frame) => frame.id === this.currentFrameId) ??
        frames[Math.min(Math.max(previousIndex, 0), frames.length - 1)];
      await this.replaceCurrent(buildExcalidrawFrameEmbed(this.embed, currentFrame.id));
      this.setCurrentFrame(currentFrame.id);
    } catch (error) {
      console.warn("Code Tab: could not refresh Excalidraw frames", error);
    }
  }
}
