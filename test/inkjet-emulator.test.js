import { afterEach, describe, expect, it, vi } from "vitest";
import { InkjetEmulator } from "../src/inkjet-emulator.js";

const { FakeGhostPclStream } = vi.hoisted(() => {
  class FakeGhostPclStream {
    static instances = [];

    constructor(options) {
      this.options = options;
      this.started = false;
      this.stopped = false;
      this.pushed = [];
      FakeGhostPclStream.instances.push(this);
    }

    async start() {
      this.started = true;
    }

    push(value) {
      this.pushed.push(value);

      if(value === 0x0c) {
        this.options.on_page_eject(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      }
    }

    async stop() {
      this.stopped = true;
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    }
  }

  return { FakeGhostPclStream };
});

vi.mock("../src/ghostpcl-stream.js", () => ({
  GhostPclStream: FakeGhostPclStream,
}));

function makePrinter() {
  const events = {
    statuses: [],
    thumbnails: [],
  };

  const printer = new InkjetEmulator({
    on_receive_status(value) {
      events.statuses.push(value);
    },
    on_page_eject(thumbnail) {
      events.thumbnails.push(thumbnail);
    },
    thumbnail_ppi: 72,
  });

  return { printer, events };
}

function writeByte(printer, byte) {
  printer.send_data(byte);
  printer.send_control(0x01);
  printer.send_control(0x00);
}

async function writeByteAndFlush(printer, byte) {
  writeByte(printer, byte);
  await flushAsyncWork();
}

async function writeBytes(printer, bytes) {
  for(const byte of bytes) {
    await writeByteAndFlush(printer, byte);
  }
}

async function flushAsyncWork() {
  for(let i = 0; i < 32; i++) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeGhostPclStream.instances = [];
});

describe("InkjetEmulator", () => {
  it("requires the simplified callback options", () => {
    expect(() => new InkjetEmulator()).toThrow(/requires options/);
    expect(() => new InkjetEmulator({
      on_receive_status() {},
      on_page_eject() {},
      thumbnail_ppi: Number.NaN,
    })).toThrow(/thumbnail_ppi/);
  });

  it("writes the latched data byte on a rising control bit 0 strobe", async () => {
    const { printer } = makePrinter();

    printer.send_data(0x41);
    printer.send_control(0x00);
    printer.send_control(0x01);
    await flushAsyncWork();
    printer.send_data(0x42);
    printer.send_control(0x01);
    printer.send_control(0x00);
    printer.send_control(0x01);
    await flushAsyncWork();

    expect(FakeGhostPclStream.instances[0].pushed).toEqual([0x41, 0x42]);
  });

  it("emits initial idle, busy, ACK, and idle status values", () => {
    const { printer, events } = makePrinter();

    writeByte(printer, 0x41);

    expect(events.statuses).toEqual([0xd8, 0x58, 0x98, 0xd8]);
  });

  it("starts the GhostPCL stream on first byte", async () => {
    const { printer } = makePrinter();

    writeByte(printer, 0x1b);
    await flushAsyncWork();

    expect(FakeGhostPclStream.instances).toHaveLength(1);
    expect(FakeGhostPclStream.instances[0].options).toMatchObject({
      thumbnail_ppi: 72,
    });
    expect(FakeGhostPclStream.instances[0].started).toBe(true);
    expect(FakeGhostPclStream.instances[0].pushed).toEqual([0x1b]);
  });

  it("forwards stream page eject output as page eject events", async () => {
    const { printer, events } = makePrinter();

    writeByte(printer, 0x0c);
    await flushAsyncWork();

    expect(events.thumbnails).toEqual([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]);
  });

  it("keeps streaming across page reset bytes", async () => {
    const { printer } = makePrinter();

    await writeBytes(printer, [
      0x1b, 0x2a, 0x62, 0x30, 0x30, 0x33, 0x57,
      0x41, 0x0c, 0x42,
      0x0c,
      0x1b, 0x2a, 0x72, 0x62, 0x43,
      0x00,
      0x1b, 0x45,
    ]);

    expect(FakeGhostPclStream.instances).toHaveLength(1);
    expect(FakeGhostPclStream.instances[0].pushed).toHaveLength(19);
  });

  it("streams form feed bytes inside raster data", async () => {
    const { printer } = makePrinter();

    await writeBytes(printer, [
      0x1b, 0x2a, 0x62, 0x30, 0x30, 0x31, 0x57,
      0x0c,
      0x1b, 0x45,
    ]);

    expect(FakeGhostPclStream.instances).toHaveLength(1);
    expect(FakeGhostPclStream.instances[0].pushed).toEqual([
      0x1b, 0x2a, 0x62, 0x30, 0x30, 0x31, 0x57,
      0x0c,
      0x1b, 0x45,
    ]);
  });

  it("stops the GhostPCL stream and returns the generated PDF", async () => {
    const { printer } = makePrinter();

    await writeByteAndFlush(printer, 0x1b);
    await writeByteAndFlush(printer, 0x45);

    const pdf = printer.collect_pdf();

    await expect(pdf).resolves.toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(FakeGhostPclStream.instances).toHaveLength(1);
    expect(FakeGhostPclStream.instances[0].pushed).toEqual([0x1b, 0x45]);
    expect(FakeGhostPclStream.instances[0].stopped).toBe(true);
  });
});
