import { EventEmitter } from "./events.js";
import { GhostPdlRenderer } from "./ghostpdl-renderer.js";
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
 * @property {GhostPdlRenderer} [renderer] renderer used by to_pdf and to_png.
 */

const PARALLEL_STATUS_IDLE = 0xd8;
const PARALLEL_STATUS_BUSY = PARALLEL_STATUS_IDLE & ~0x80;
const PARALLEL_STATUS_ACK = PARALLEL_STATUS_IDLE & ~0x40;

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
    this.inputStatus = PARALLEL_STATUS_IDLE;
    this.buffer = [];
    this.pages = [];
    this.pageById = new Map();
    this.pclPageDetector = new PclPageDetector();
    this.renderer = options.renderer || new GhostPdlRenderer();
    this.receivePageEvent = new EventEmitter();
    this.inputStatusEvent = new EventEmitter();
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
      this.acknowledgeStrobe();
    }
  }

  /**
   * Register for status-register updates.
   * @param {(value: number) => void} handler
   * @returns {() => void} unsubscribe function
   */
  on_input_status(handler) {
    return this.inputStatusEvent.on(handler);
  }

  on_input_data(value) {

  }

  /**
   * Read the current emulated parallel-port status byte.
   * @returns {number}
   */
  get_input_status() {
    return this.inputStatus;
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
    const totalLength = data.reduce((sum, page) => sum + page.length, 0);
    const pclBytes = new Uint8Array(totalLength);
    let offset = 0;

    for(const page of data) {
      pclBytes.set(page, offset);
      offset += page.length;
    }

    return this.renderer.toPdf(pclBytes);
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
    if(this.buffer.length === 0) {
      return null;
    }

    if(isCommandOnlyBuffer(this.buffer)) {
      this.buffer.length = 0;
      return null;
    }

    const page = {
      id: crypto.randomUUID(),
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

    if(this.pclPageDetector.push(byte)) {
      this.flush("pcl-page-end");
    }
  }

  acknowledgeStrobe() {
    this.setInputStatus(PARALLEL_STATUS_BUSY);
    this.setInputStatus(PARALLEL_STATUS_ACK);
    this.setInputStatus(PARALLEL_STATUS_IDLE);
  }

  setInputStatus(status) {
    status &= 0xff;

    if(this.inputStatus === status) {
      return;
    }

    this.inputStatus = status;
    this.inputStatusEvent.emit(status);
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

function isCommandOnlyBuffer(bytes) {
  let index = 0;
  let sawCommand = false;

  while(index < bytes.length) {
    const byte = bytes[index] & 0xff;

    if(isIgnorableSeparator(byte)) {
      index++;
      continue;
    }

    if(byte === 0x1b) {
      const nextIndex = skipEscapeSequence(bytes, index);

      if(nextIndex === index) {
        return false;
      }

      sawCommand = true;
      index = nextIndex;
      continue;
    }

    if(startsWithAscii(bytes, index, "@PJL")) {
      sawCommand = true;
      index = skipAsciiLine(bytes, index);
      continue;
    }

    return false;
  }

  return sawCommand;
}

function isIgnorableSeparator(byte) {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;
}

function skipEscapeSequence(bytes, start) {
  let index = start + 1;
  let command = "";

  while(index < bytes.length) {
    const byte = bytes[index] & 0xff;
    command += String.fromCharCode(byte);
    index++;

    if(byte >= 0x40 && byte <= 0x7e) {
      if(escapeSequenceHasPayload(command)) {
        return start;
      }

      return index;
    }
  }

  return start;
}

function escapeSequenceHasPayload(command) {
  if(command.endsWith("V") && command.startsWith("*b")) {
    return escapeSequencePayloadLength(command, "V") > 0;
  }

  if(command.endsWith("W")) {
    return escapeSequencePayloadLength(command, "W") > 0;
  }

  return false;
}

function escapeSequencePayloadLength(command, terminator) {
  const match = command.match(new RegExp(`([-+]?\\d+)${terminator}$`));
  return match ? Number(match[1]) : 0;
}

function startsWithAscii(bytes, index, text) {
  if(index + text.length > bytes.length) {
    return false;
  }

  for(let offset = 0; offset < text.length; offset++) {
    if((bytes[index + offset] & 0xff) !== text.charCodeAt(offset)) {
      return false;
    }
  }

  return true;
}

function skipAsciiLine(bytes, index) {
  while(index < bytes.length) {
    const byte = bytes[index] & 0xff;
    index++;

    if(byte === 0x0a || byte === 0x0c) {
      break;
    }
  }

  return index;
}
