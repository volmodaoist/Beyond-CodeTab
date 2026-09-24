import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const watch = process.argv.includes("--watch");

const options = {
  absWorkingDir: root,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  // 与 Obsidian 共享 CodeMirror 实例，避免重复打包后扩展对象无法被宿主识别。
  external: ["obsidian", "@codemirror/state", "@codemirror/view"],
  format: "cjs",
  platform: "browser",
  target: "es2019",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  plugins: [{
    name: "plugin-assets",
    setup(build) {
      // 样式和清单也参与 watch；每次构建都产出可直接安装的三个文件。
      build.onLoad({ filter: /main[.]ts$/ }, () => ({
        watchFiles: ["src/styles.css", "manifest.json"].map((path) =>
          fileURLToPath(new URL(path, import.meta.url))
        ),
      }));
      build.onEnd(async (result) => {
        if (result.errors.length) return;
        await mkdir(new URL("dist/", import.meta.url), { recursive: true });
        await Promise.all([
          copyFile(new URL("src/styles.css", import.meta.url), new URL("dist/styles.css", import.meta.url)),
          copyFile(new URL("manifest.json", import.meta.url), new URL("dist/manifest.json", import.meta.url)),
        ]);
      });
    },
  }],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
