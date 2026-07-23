const GLUE_URL = new URL(/* @vite-ignore */ "./gpcl-stream.js", import.meta.url);
const WASM_URL = new URL(/* @vite-ignore */ "./gpcl-stream.wasm", import.meta.url);
const FONT_BASE_URL = new URL(/* @vite-ignore */ "./fonts-dj500-min/", import.meta.url);
const FONT_FILES = [
  "ArtLinePrinter.ttf",
  "NimbusMono-Bold.ttf",
  "NimbusMono-BoldItalic.ttf",
  "NimbusMono-Italic.ttf",
  "NimbusMono-Regular.ttf",
];


const THUMBNAIL_PATH_RE = /^\/work\/thumb-\d{6}\.png$/;

/**
 * @typedef {object} GhostPclStreamOptions
 * @property {number} thumbnail_ppi
 * @property {(thumbnail: Uint8Array) => void} on_page_eject
 */

/**
 * @param {URL} url
 * @returns {string}
 */
function urlToAssetLocation(url) {
  if (url.protocol === "file:") {
    return decodeURIComponent(url.pathname);
  }

  return url.href;
}

/**
 * @param {URL} url
 * @returns {Promise<Uint8Array>}
 */
async function readUrlBytes(url) {
  if (url.protocol === "file:") {
    const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
    return new Uint8Array(await readFile(url));
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url.href}: HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * @param {any} module
 * @param {string} path
 */
function mkdirp(module, path) {
  let current = "";

  for (const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;
    if (!module.FS.analyzePath(current).exists) {
      module.FS.mkdir(current);
    }
  }
}

/**
 * @param {any} module
 */
async function stageFonts(module) {
  mkdirp(module, "/windows/fonts");

  await Promise.all(FONT_FILES.map(async (fileName) => {
    const fontUrl = new URL(fileName, FONT_BASE_URL);
    const fontBytes = await readUrlBytes(fontUrl);
    module.FS.writeFile(`/windows/fonts/${fileName}`, fontBytes);
  }));
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isThumbnailPath(path) {
  return THUMBNAIL_PATH_RE.test(path);
}

/**
 * Abstraction between InkjetEmulator and the top C layer. An important addition is that 
 * it hooks into Emscripten FS's file close events to detect when output files are written
 * by GhostPDL. This allows it to detect page ejects and PDF conversion completion.
 */
export class GhostPclStream {
  /** @type {GhostPclStreamOptions} */
  #options;
  /** @type {any} */
  #module = null;
  /** @type {number} */
  #handle = 0;
  /** @type {Uint8Array[]} */
  #pendingThumbnails = [];
  /** @type {boolean} */
  #started = false;
  /** @type {boolean} */
  #stopped = false;

  /**
   * @param {GhostPclStreamOptions} options
   */
  constructor(options) {
    if (!options || typeof options.thumbnail_ppi !== "number") {
      throw new TypeError("thumbnail_ppi is required");
    }
    if (typeof options.on_page_eject !== "function") {
      throw new TypeError("on_page_eject is required");
    }

    this.#options = options;
  }

  /** initialize */
  async start() {
    if (this.#started) {
      throw new Error("GhostPclStream has already started");
    }

    const { default: createGpclStreamModule } = await import(/* @vite-ignore */ GLUE_URL.href);
    const module = await createGpclStreamModule({
      locateFile(path, prefix) {
        if (path.endsWith(".wasm")) {
          return urlToAssetLocation(WASM_URL);
        }

        return `${prefix}${path}`;
      },
      noInitialRun: true,
      print() {},
      printErr() {},
    });

    this.#module = module;
    await stageFonts(module);
    mkdirp(module, "/work");
    this.#cleanWorkDirectory();
    this.#hookClose();

    this.#handle = module._gpcl_stream_create(this.#options.thumbnail_ppi | 0);
    if (!this.#handle) {
      throw new Error("gpcl_stream_create failed");
    }

    this.#started = true;
  }

  /**
   * push a byte, possibly triggering on_page_eject
   * @param {number} value
   */
  push(value) {
    if (!this.#started || this.#stopped || !this.#module || !this.#handle) {
      throw new Error("GhostPclStream is not running");
    }

    this.#module._gpcl_stream_push(this.#handle, value | 0);
    this.#flushPageEjects();
  }

  /**
   * close stream and return the PDF
   * @returns {Promise<Uint8Array>}
   */
  async stop() {
    if (!this.#started || this.#stopped || !this.#module || !this.#handle) {
      throw new Error("GhostPclStream is not running");
    }

    const module = this.#module;
    module._gpcl_stream_destroy(this.#handle);
    this.#handle = 0;
    this.#stopped = true;

    this.#flushPageEjects();
    return new Uint8Array(module.FS.readFile("/work/file.pdf"));
  }

  #cleanWorkDirectory() {
    for (const name of this.#module.FS.readdir("/work")) {
      if (name === "." || name === "..") {
        continue;
      }

      this.#module.FS.unlink(`/work/${name}`);
    }
  }

  #hookClose() {
    const module = this.#module;
    const originalOpen = module.FS.open.bind(module.FS);
    const originalClose = module.FS.close.bind(module.FS);
    const streamPaths = new WeakMap();

    module.FS.open = (...args) => {
      const stream = originalOpen(...args);
      if (typeof args[0] === "string") {
        streamPaths.set(stream, args[0]);
      }
      return stream;
    };

    const hookedClose = (stream) => {
      const path = streamPaths.get(stream) || stream?.path || "";
      const result = originalClose(stream);

      if (isThumbnailPath(path)) {
        module.FS.close = originalClose;
        try {
          this.#pendingThumbnails.push(new Uint8Array(module.FS.readFile(path)));
        } finally {
          module.FS.close = hookedClose;
        }
      }

      return result;
    };

    module.FS.close = hookedClose;
  }

  #flushPageEjects() {
    while (this.#pendingThumbnails.length > 0) {
      this.#options.on_page_eject(this.#pendingThumbnails.shift());
    }
  }
}
