import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function copyGhostPdlAssets() {
  return {
    name: "copy-ghostpdl-assets",
    closeBundle() {
      const files = [
        ["src/vendor/gpcl6.wasm", "dist/assets/gpcl6.wasm"],
      ];

      for(const fileName of readdirSync("src/vendor/fonts")) {
        files.push([
          `src/vendor/fonts/${fileName}`,
          `dist/assets/fonts/${fileName}`,
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
    copyGhostPdlAssets(),
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
