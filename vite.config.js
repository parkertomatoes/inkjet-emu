import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function copyGhostPclStreamAssets() {
  return {
    name: "copy-ghostpcl-stream-assets",
    closeBundle() {
      const files = [
        ["src/vendor/ghostpcl-stream/gpcl-stream.js", "dist/gpcl-stream.js"],
        ["src/vendor/ghostpcl-stream/gpcl-stream.wasm", "dist/gpcl-stream.wasm"],
      ];

      for(const fileName of readdirSync("src/vendor/ghostpcl-stream/fonts-dj500-min")) {
        files.push([
          `src/vendor/ghostpcl-stream/fonts-dj500-min/${fileName}`,
          `dist/fonts-dj500-min/${fileName}`,
        ]);
      }

      for(const [from, to] of files) {
        const destination = resolve(to);

        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(resolve(from), destination);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    copyGhostPclStreamAssets(),
  ],
  build: {
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
  },
});
