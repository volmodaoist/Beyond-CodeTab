import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = fileURLToPath(new URL(".", import.meta.url));
const watch = process.argv.includes("--watch");

const options = {
  absWorkingDir: root,
  entryPoints: ["src/main.ts", "src/styles.css"],
  outdir: "dist",
  bundle: true,
  // 与 Obsidian 共享 CodeMirror 实例，避免重复打包后扩展对象无法被宿主识别。
  external: ["obsidian", "@codemirror/state", "@codemirror/view"],
  format: "cjs",
  platform: "browser",
  target: "es2019",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  plugins: [
    {
      name: "plugin-assets",
      setup(build) {
        // CSS 的 @import 由 esbuild 合并并自动监听；清单也参与 watch。
        build.onLoad(
          {
            filter: /main[.]ts$/,
          },
          () => ({
            watchFiles: ["manifest.json"].map((path) =>
              fileURLToPath(new URL(path, import.meta.url)),
            ),
          }),
        );
        build.onEnd(async (result) => {
          if (result.errors.length) {
            return;
          }
          await mkdir(new URL("dist/", import.meta.url), {
            recursive: true,
          });
          await Promise.all([
            copyFile(
              new URL("manifest.json", import.meta.url),
              new URL("dist/manifest.json", import.meta.url),
            ),
          ]);
        });
      },
    },
  ],
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
