# inkjet-emu

A JS library for printing from legacy PC emulators.

Features include
  - Generic parallel port interface with no emulator dependency
  - Supports the HP PCL 3 protocol, including color
  - Page eject events with PNG thumbnails
  - Prints multi-page PDFs
  - Reliable rendering using GhostPDL compiled to WASM

## Usage
```js
import { InkjetEmulator } from "inkjet-emu";

const printer = new InkjetEmulator({
  // options
  thumbnail_ppi: 72,

  // printer -> emulator
  on_receive_status(value) {
    emulator.bus.send("parallel0-status-input", value);
  },

  // printer page previews
  on_page_eject(thumbnail) {
    console.log("PNG thumbnail bytes", thumbnail.byteLength);
  }
});

// emulator -> printer
emulator.add_listener("parallel0-data-output", value => {
  printer.send_data(value);
});
emulator.add_listener("parallel0-control-output", value => {
  printer.send_control(value);
});

// ...to collect a PDF when it's ready
const pdfBytes = printer.collect_pdf();
```

## Development

Use Node 22.

The GhostPCL stream code from `harness-ghostpdl3` lives in
`src/ghostpcl-stream.js`, with its wrapper source in `c/`. The GhostPDL
PaintJet fork is included as the `ghostpcl`
submodule. The root Vite build compiles the GhostPCL WASM
wrapper and copies the required fonts from `ghostpcl/pcl/urwfonts` into
`dist/`.

```sh
git submodule update --init --recursive
npm install
npm run build
```

The GhostPCL stream WASM build is driven by CMake through `emcmake`, which must
be on `PATH`. CMake configures the `ghostpcl` submodule as a GhostPDL
Emscripten build, builds its `libgpcl6` archive, and links the stream wrapper
against that archive.

## API

#### InkjetEmulatorOptions

InkjetEmulator configuration options passed to constructor

| Field             | Type                            | Description                                                         |
| ----------------- | ------------------------------- | ------------------------------------------------------------------- |
| thumbnail_ppi     | number                          | Pixels per inch to render thumbnails                                |
| on_receive_status | (value: byte) => void           | Handler for when the printer drives the parallel port status lines. |
| on_page_eject     | (thumbnail: Uint8Array) => void | Handler for when the printer ejects a page.                         |

#### class InjetEmulator

| Method         | Signature                                | Description                                         |
| -------------- | ---------------------------------------- | --------------------------------------------------- |
| constructor()  | (options: InkjetEmulatorOptions) => void | Latch data on the parallel port data lines          |
| send_data()    | (value: byte) => void                    | Latch data on the parallel port data lines          |
| send_control() | (value: byte) => void                    | Drive the parallel port control lines.              |
| collect_pdf()  | () => Promise&lt;Uint8Array&gt;          | Flush print queue and generate PDF of its contents. |
