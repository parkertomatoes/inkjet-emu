import { describe, expect, it, vi } from "vitest";
import { InkjetEmulator } from "../src/inkjet-emulator.js";
import { PclPageDetector } from "../src/pcl-page-detector.js";

function makePrinter(options = {}) {
  return new InkjetEmulator({
    renderer: {
      toPdf: vi.fn(async bytes => bytes),
      toPng: vi.fn(async bytes => bytes),
    },
    ...options,
  });
}

function writeByte(printer, byte) {
  printer.send_output_data(byte);
  printer.send_output_control(0x01);
  printer.send_output_control(0x00);
}

describe("InkjetEmulator", () => {
  it("writes the latched data byte on a rising control bit 0 strobe", () => {
    const printer = makePrinter();

    printer.send_output_data(0x41);
    printer.send_output_control(0x00);
    printer.send_output_control(0x01);
    printer.send_output_data(0x42);
    printer.send_output_control(0x01);
    printer.send_output_control(0x00);
    printer.send_output_control(0x01);

    const id = printer.flush();

    expect(printer.pageById.get(id).data).toEqual(new Uint8Array([0x41, 0x42]));
  });

  it("emits busy, ACK, and idle immediately after a strobe", () => {
    const printer = makePrinter();
    const statuses = [];

    printer.on_input_status(status => statuses.push(status));

    writeByte(printer, 0x41);

    expect(statuses).toEqual([0x58, 0x98, 0xd8]);
    expect(printer.get_input_status()).toBe(0xd8);
  });

  it("queues pages and emits receive events when PCL page end is detected", () => {
    const printer = makePrinter();
    const received = [];

    printer.on_receive_page(id => received.push(id));

    for(const byte of [0x1b, 0x45, 0x48, 0x69, 0x0c]) {
      writeByte(printer, byte);
    }

    expect(printer.get_pages()).toHaveLength(1);
    expect(received).toEqual(printer.get_pages());
  });

  it("drops command-only buffers that end with a form feed", () => {
    const printer = makePrinter();

    for(const byte of [0x1b, 0x45, 0x0c]) {
      writeByte(printer, byte);
    }

    expect(printer.get_pages()).toEqual([]);
    expect(printer.buffer).toEqual([]);
  });

  it("ignores form feed bytes inside PCL binary payloads", () => {
    const printer = makePrinter();

    for(const byte of [0x1b, 0x2a, 0x62, 0x33, 0x57, 0x0c, 0x0c, 0x0c]) {
      writeByte(printer, byte);
    }

    expect(printer.get_pages()).toEqual([]);

    writeByte(printer, 0x0c);

    expect(printer.get_pages()).toHaveLength(1);
  });

  it("removes requested pages and keeps remaining order", () => {
    const printer = makePrinter();
    const ids = [];

    writeByte(printer, 0x41);
    ids.push(printer.flush("test"));
    writeByte(printer, 0x42);
    ids.push(printer.flush("test"));
    writeByte(printer, 0x43);
    ids.push(printer.flush("test"));

    printer.remove_pages([ids[1], "missing"]);

    expect(printer.get_pages()).toEqual([ids[0], ids[2]]);
  });

  it("renders selected pages as a concatenated PDF input", async () => {
    const renderer = {
      toPdf: vi.fn(async bytes => bytes),
      toPng: vi.fn(async bytes => bytes),
    };
    const printer = makePrinter({ renderer });

    writeByte(printer, 0x41);
    const first = printer.flush("test");
    writeByte(printer, 0x42);
    const second = printer.flush("test");

    await expect(printer.to_pdf([second, first])).resolves.toEqual(new Uint8Array([0x42, 0x41]));
    expect(renderer.toPdf).toHaveBeenCalledWith(new Uint8Array([0x42, 0x41]));
  });

  it("renders a single selected page as PNG input", async () => {
    const renderer = {
      toPdf: vi.fn(async bytes => bytes),
      toPng: vi.fn(async bytes => bytes),
    };
    const printer = makePrinter({ renderer });

    writeByte(printer, 0x41);
    const id = printer.flush("test");

    await expect(printer.to_png(id, { width: 10, height: 20 })).resolves.toEqual(new Uint8Array([0x41]));
    expect(renderer.toPng).toHaveBeenCalledWith(new Uint8Array([0x41]), { width: 10, height: 20 });
  });
});

describe("PclPageDetector", () => {
  it("detects form feed outside binary transfer data", () => {
    const detector = new PclPageDetector();
    const bytes = [0x1b, 0x2a, 0x62, 0x32, 0x57, 0x0c, 0x0c, 0x0c];
    const results = bytes.map(byte => detector.push(byte));

    expect(results).toEqual([false, false, false, false, false, false, false, true]);
  });
});
