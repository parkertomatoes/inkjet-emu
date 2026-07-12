import gpcl6Source from "./vendor/gpcl6.js?raw";

const defaultAssetBaseUrl = new URL(/* @vite-ignore */ "./assets/", import.meta.url).href;

let runtimeReady = null;
let fontsReady = null;
let runtimeMessages = [];

function withTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function defaultFonts(assetBaseUrl) {
  return [
    ["ArtLinePrinter.ttf", new URL("fonts/ArtLinePrinter.ttf", assetBaseUrl).href],
    ["NimbusMono-Regular.ttf", new URL("fonts/NimbusMono-Regular.ttf", assetBaseUrl).href],
    ["NimbusMono-Bold.ttf", new URL("fonts/NimbusMono-Bold.ttf", assetBaseUrl).href],
    ["NimbusMono-Italic.ttf", new URL("fonts/NimbusMono-Italic.ttf", assetBaseUrl).href],
    ["NimbusMono-BoldItalic.ttf", new URL("fonts/NimbusMono-BoldItalic.ttf", assetBaseUrl).href],
  ];
}

function requireBrowserRuntime() {
  if(typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    throw new Error("GhostPDL rendering requires a browser-like runtime");
  }
}

function getFs() {
  const fs = globalThis.FS;

  if(!fs) {
    throw new Error("GhostPDL FS is not available");
  }

  return fs;
}

function getCallMain() {
  const callMain = globalThis.callMain;

  if(typeof callMain !== "function") {
    throw new Error("GhostPDL callMain is not available");
  }

  return callMain;
}

function mkdirp(path) {
  const fs = getFs();
  let current = "";

  for(const part of path.split("/").filter(Boolean)) {
    current += `/${part}`;

    try {
      fs.mkdir(current);
    }
    catch(error) {
      if(error && error.errno !== 20) {
        throw error;
      }
    }
  }
}

async function fetchBytes(url) {
  const response = await fetch(url);

  if(!response.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function unlinkIfExists(path) {
  try {
    getFs().unlink(path);
  }
  catch {
    // File did not exist.
  }
}

function removeMatchingFiles(directory, pattern) {
  const fs = getFs();

  for(const name of fs.readdir(directory)) {
    if(pattern.test(name)) {
      fs.unlink(`${directory}/${name}`);
    }
  }
}

async function loadRuntime(wasmUrl) {
  requireBrowserRuntime();

  if(runtimeReady) {
    return runtimeReady;
  }

  runtimeReady = new Promise((resolve, reject) => {
    globalThis.Module = {
      noInitialRun: true,
      preRun() {
        globalThis.ENV.PCLFONTSOURCE = "/windows/fonts/";
      },
      locateFile(path) {
        return path.endsWith(".wasm") ? wasmUrl : path;
      },
      instantiateWasm(imports, receiveInstance) {
        fetch(wasmUrl)
          .then(response => {
            if(!response.ok) {
              throw new Error(`Could not fetch ${wasmUrl}: HTTP ${response.status}`);
            }

            return response.arrayBuffer();
          })
          .then(bytes => WebAssembly.instantiate(bytes, imports))
          .then(({ instance, module }) => {
            receiveInstance(instance, module);
          })
          .catch(reject);

        return {};
      },
      print(message) {
        runtimeMessages.push(String(message));
      },
      printErr(message) {
        runtimeMessages.push(String(message));
      },
      onRuntimeInitialized() {
        resolve();
      },
    };

    const blobUrl = URL.createObjectURL(new Blob([gpcl6Source], {
      type: "text/javascript",
    }));
    const script = document.createElement("script");

    script.src = blobUrl;
    script.onload = () => URL.revokeObjectURL(blobUrl);
    script.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("Could not load embedded gpcl6 runtime"));
    };

    document.head.appendChild(script);
  });

  return runtimeReady;
}

async function stageFonts(wasmUrl, fonts) {
  if(fontsReady) {
    return fontsReady;
  }

  fontsReady = (async () => {
    await loadRuntime(wasmUrl);
    mkdirp("/windows/fonts");

    await Promise.all(fonts.map(async ([fileName, url]) => {
      getFs().writeFile(`/windows/fonts/${fileName}`, await fetchBytes(url));
    }));
  })();

  return fontsReady;
}

/**
 * @typedef {object} GhostPdlRendererOptions
 * @property {string} [assetBaseUrl] base URL containing gpcl6.wasm and fonts/.
 * @property {string} [wasmUrl] explicit gpcl6.wasm URL.
 * @property {Array<[string, string]>} [fonts] font filename/url pairs staged under /windows/fonts.
 */

export class GhostPdlRenderer {
  /**
   * @param {GhostPdlRendererOptions} [options]
   */
  constructor(options = {}) {
    this.assetBaseUrl = withTrailingSlash(options.assetBaseUrl || defaultAssetBaseUrl);
    this.wasmUrl = options.wasmUrl || new URL("gpcl6.wasm", this.assetBaseUrl).href;
    this.fonts = options.fonts || defaultFonts(this.assetBaseUrl);
    this.queue = Promise.resolve();
    this.sequence = 0;
  }

  /**
   * @param {Uint8Array} pclBytes
   * @returns {Promise<Uint8Array>}
   */
  toPdf(pclBytes) {
    return this.enqueue(() => this.convertToPdf(pclBytes));
  }

  /**
   * @param {Uint8Array} pclBytes
   * @param {{ width?: number, height?: number }} [options]
   * @returns {Promise<Uint8Array>}
   */
  toPng(pclBytes, options = {}) {
    return this.enqueue(() => this.convertToPng(pclBytes, options));
  }

  enqueue(task) {
    const result = this.queue.then(task);

    this.queue = result.catch(() => {});
    return result;
  }

  async prepare() {
    await loadRuntime(this.wasmUrl);
    await stageFonts(this.wasmUrl, this.fonts);
    mkdirp("/work");
  }

  async convertToPdf(pclBytes) {
    await this.prepare();

    const fs = getFs();
    const inputPath = `/work/input-${++this.sequence}.pcl`;
    const outputPath = `/work/output-${this.sequence}.pdf`;

    unlinkIfExists(inputPath);
    unlinkIfExists(outputPath);
    fs.writeFile(inputPath, pclBytes);

    this.callGhostPdl([
      "-dNOPAUSE",
      "-dBATCH",
      "-sDEVICE=pdfwrite",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ]);

    const output = fs.readFile(outputPath);

    unlinkIfExists(inputPath);
    unlinkIfExists(outputPath);

    return output;
  }

  async convertToPng(pclBytes, options) {
    await this.prepare();

    const fs = getFs();
    const inputPath = `/work/input-${++this.sequence}.pcl`;
    const outputPattern = `/work/page-${this.sequence}-%03d.png`;
    const outputPatternRegex = new RegExp(`^page-${this.sequence}-\\d+\\.png$`);
    const geometry = this.getGeometryArgument(options);

    unlinkIfExists(inputPath);
    removeMatchingFiles("/work", outputPatternRegex);
    fs.writeFile(inputPath, pclBytes);

    this.callGhostPdl([
      "-dNOPAUSE",
      "-dBATCH",
      "-sDEVICE=png16m",
      ...(geometry ? [geometry] : []),
      `-sOutputFile=${outputPattern}`,
      inputPath,
    ]);

    const outputName = fs.readdir("/work")
      .filter(name => outputPatternRegex.test(name))
      .sort()[0];

    if(!outputName) {
      throw new Error("GhostPDL did not produce a PNG page");
    }

    const output = fs.readFile(`/work/${outputName}`);

    unlinkIfExists(inputPath);
    removeMatchingFiles("/work", outputPatternRegex);

    return output;
  }

  callGhostPdl(args) {
    const messageStart = runtimeMessages.length;
    const exitCode = getCallMain()(args);
    const conversionMessages = runtimeMessages.slice(messageStart);
    const interpreterWarning = conversionMessages.find(message => (
      message.includes("Warning interpreter exited")
    ));

    if(exitCode !== 0) {
      throw new Error(`gpcl6 exited with code ${exitCode}`);
    }

    if(interpreterWarning) {
      throw new Error(interpreterWarning);
    }
  }

  getGeometryArgument(options) {
    const width = options.width === undefined ? undefined : Number(options.width);
    const height = options.height === undefined ? undefined : Number(options.height);

    if(width === undefined && height === undefined) {
      return null;
    }

    if(!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error("PNG width and height must both be positive integers");
    }

    return `-g${width}x${height}`;
  }
}
