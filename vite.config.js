import { defineConfig } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const GHOSTPCL_FONT_FILES = [
  "ArtLinePrinter.ttf",
  "NimbusMono-Bold.ttf",
  "NimbusMono-BoldItalic.ttf",
  "NimbusMono-Italic.ttf",
  "NimbusMono-Regular.ttf",
];

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });
  if(result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? 1}`);
  }
}

function buildGhostPclStreamAssets() {
  return {
    name: "build-ghostpcl-stream-assets",
    apply: "build",
    closeBundle() {
      console.info("[ghostpcl] Building stream WASM assets. This can take a while...");
      run("emcmake", [
        "cmake",
        "-S", ".",
        "-B", "build/ghostpcl-wasm",
        "-U", "GHOSTPDL_ROOT",
        "-U", "GHOSTPDL_BUILD",
        "-U", "WASM_OPT",
      ]);
      run("cmake", [
        "--build", "build/ghostpcl-wasm",
        "--target", "gpcl-stream-dist",
        "--parallel",
      ]);

      console.info("[ghostpcl] Copying printer font assets...");
      const fontSourceDir = resolve("ghostpcl/pcl/urwfonts");
      const fontTargetDir = resolve("dist/fonts-dj500-min");
      mkdirSync(fontTargetDir, { recursive: true });

      for(const fileName of GHOSTPCL_FONT_FILES) {
        copyFileSync(
          resolve(fontSourceDir, fileName),
          resolve(fontTargetDir, fileName),
        );
      }
      console.info("[ghostpcl] Stream WASM assets are ready.");
    },
  };
}

export default defineConfig({
  plugins: [
    buildGhostPclStreamAssets(),
  ],
  build: {
    emptyOutDir: false,
    lib: {
      entry: "src/index.js",
      name: "InkjetEmu",
      fileName: "inkjet-emu",
      formats: ["es"],
    },
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
    pool: "threads",
  },
});
