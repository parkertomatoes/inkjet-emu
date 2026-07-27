# inkjet-emu

A JS library for printing from legacy PC emulators.

Features include
  - Generic parallel port interface with no emulator dependency
  - Supports the HP PCL 5e protocol, including color
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

## Building

Requires:
  - Node 22+
  - Emscripten, in particular emcmake must be in PATH

Building:
1. Initialize the git submodule. This is a one-time step and can be skipped in future builds
    ```
    git submodule update --init --recursive
    ```
2. To build (use "rebuild" to clean build artifacts first)
    ```
    npm run build
    ```

## Testing

```
npm run test
```

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
