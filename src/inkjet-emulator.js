import { concatUint8Arrays } from "./bytes.js";
import { EventEmitter } from "./events.js";
import { GhostPdlRenderer } from "./ghostpdl-renderer.js";
import { randomId } from "./ids.js";
import { PclPageDetector } from "./pcl-page-detector.js";

/**
 * @typedef {object} InkjetPage
 * @property {string} id
 * @property {Uint8Array} data
 * @property {string} reason
 * @property {number} createdAt
 */

/**
 * @typedef {object} InkjetEmulatorOptions
 * @property {number} [autoFlushMs=1500] flush partial jobs after inactivity. Use 0 to disable.
 * @property {boolean} [flushOnPclPageEnd=true] flush when the PCL page detector sees a page end.
 * @property {boolean} [flushOnFormFeed=false] additionally flush on raw form-feed bytes.
 * @property {GhostPdlRenderer} [renderer] renderer used by to_pdf and to_png.
 */

/**
 * Virtual PCL inkjet printer attached through generic parallel-port events.
 */
export class InkjetEmulator {
  /**
   * @param {InkjetEmulatorOptions} [options]
   */
  constructor(options = {}) {
    this.outputData = 0;
    this.outputControl = 0;
    this.buffer = [];
    this.pages = [];
    this.pageById = new Map();
    this.autoFlushMs = options.autoFlushMs ?? 1500;
    this.flushOnPclPageEnd = options.flushOnPclPageEnd !== false;
    this.flushOnFormFeed = options.flushOnFormFeed === true;
    this.pclPageDetector = this.flushOnPclPageEnd ? new PclPageDetector() : null;
    this.flushTimer = undefined;
    this.renderer = options.renderer || new GhostPdlRenderer();
    this.receivePageEvent = new EventEmitter();
    this.inputDataEvent = new EventEmitter();
    this.inputControlEvent = new EventEmitter();
  }

  /**
   * Latch one output byte from the host side of the parallel port.
   * @param {number} value
   */
  send_output_data(value) {
    this.outputData = value & 0xff;
  }

  /**
   * Latch one control byte from the host. A rising edge on bit 0 strobes the
   * current data byte into the print stream.
   * @param {number} value
   */
  send_output_control(value) {
    const previousControl = this.outputControl;

    this.outputControl = value & 0x1f;

    if((this.outputControl & 1) && !(previousControl & 1)) {
      this.writeOutputByte(this.outputData);
    }
  }

  /**
   * Stub for future bidirectional/PJL data reads.
   * @param {(value: number) => void} handler
   * @returns {() => void} unsubscribe function
   */
  on_input_data(handler) {
    return this.inputDataEvent.on(handler);
  }

  /**
   * Stub for future bidirectional/PJL control reads.
   * @param {(value: number) => void} handler
   * @returns {() => void} unsubscribe function
   */
  on_input_control(handler) {
    return this.inputControlEvent.on(handler);
  }

  /**
   * Register a page-received event handler.
   * @param {(id: string) => void} handler
   * @returns {() => void} unsubscribe function
   */
  on_receive_page(handler) {
    return this.receivePageEvent.on(handler);
  }

  /**
   * Retrieve IDs of pages in the order printed.
   * @returns {string[]}
   */
  get_pages() {
    return this.pages.map(page => page.id);
  }

  /**
   * Remove pages from the queue. Unknown page IDs are ignored.
   * @param {string[]} pages
   */
  remove_pages(pages) {
    const remove = new Set(pages);

    this.pages = this.pages.filter(page => {
      if(remove.has(page.id)) {
        this.pageById.delete(page.id);
        return false;
      }

      return true;
    });
  }

  /**
   * Render one or more queued pages as a single multi-page PDF.
   * @param {string[]} pages
   * @returns {Promise<Uint8Array>}
   */
  async to_pdf(pages) {
    const data = this.getPageData(pages);
    return this.renderer.toPdf(concatUint8Arrays(data));
  }

  /**
   * Preview a single queued page as a PNG image.
   * @param {string} page
   * @param {{ width?: number, height?: number }} [options]
   * @returns {Promise<Uint8Array>}
   */
  async to_png(page, options = {}) {
    const data = this.getPageData([page]);
    return this.renderer.toPng(data[0], options);
  }

  /**
   * Flush the current print stream into the page queue.
   * @param {string} [reason]
   * @returns {string | null} page ID when a page was queued.
   */
  flush(reason = "manual") {
    this.clearFlushTimer();

    if(this.buffer.length === 0) {
      return null;
    }

    const page = {
      id: randomId(),
      data: new Uint8Array(this.buffer),
      reason,
      createdAt: Date.now(),
    };

    this.buffer.length = 0;
    this.pages.push(page);
    this.pageById.set(page.id, page);
    this.receivePageEvent.emit(page.id);

    return page.id;
  }

  writeOutputByte(byte) {
    byte &= 0xff;
    this.buffer.push(byte);

    if(this.pclPageDetector && this.pclPageDetector.push(byte)) {
      this.flush("pcl-page-end");
      return;
    }

    if(this.flushOnFormFeed && byte === 0x0c) {
      this.flush("form-feed");
      return;
    }

    if(this.autoFlushMs > 0) {
      this.clearFlushTimer();
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        this.flush("timeout");
      }, this.autoFlushMs);
    }
  }

  clearFlushTimer() {
    if(this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  getPageData(ids) {
    if(!Array.isArray(ids)) {
      throw new TypeError("pages must be an array of page IDs");
    }

    return ids.map(id => {
      const page = this.pageById.get(id);

      if(!page) {
        throw new Error(`Unknown page ID: ${id}`);
      }

      return page.data;
    });
  }
}
