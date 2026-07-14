# inkjet-emu

`inkjet-emu` is a browser-side JavaScript library for capturing bytes from a
virtual parallel printer port, queueing completed PCL pages, and rendering those
pages through a browser-enabled GhostPDL WASM build.

The library is independent of v86. A v86 integration can bridge the generic LPT
methods to the emulator bus events:

```js
import { InkjetEmulator } from "inkjet-emu";

const printer = new InkjetEmulator();

emulator.add_listener("parallel0-data-output", value => {
  printer.send_output_data(value);
});
emulator.add_listener("parallel0-control-output", value => {
  printer.send_output_control(value);
});

printer.on_input_status(value => {
  emulator.bus.send("parallel0-status-input", value);
});

printer.on_receive_page(async id => {
  const png = await printer.to_png(id);
  console.log(id, png.byteLength);
});
```

## API

```js
const printer = new InkjetEmulator(options);

// Host/LPT adapter -> printer.
printer.send_output_data(0x41);
printer.send_output_control(0x01);

// Printer -> host/LPT adapter status register.
printer.get_input_status();
printer.on_input_status(value => {});

printer.on_receive_page(id => {});

const ids = printer.get_pages();
const pdf = await printer.to_pdf(ids);
const png = await printer.to_png(ids[0], { width: 2550, height: 3300 });
printer.remove_pages(ids);
```

The parallel-port capture logic follows the LPT device direction:
`send_output_data` and `send_output_control` are host writes to the printer.
`on_input_status` is the printer driving the host-visible status register; in a
v86 bridge, send those values to `parallel0-status-input`. Each strobe emits
busy (`0x58`), ACK asserted (`0x98`), and idle (`0xd8`) immediately by default.
Page detection defaults to PCL page-end detection with binary raster payload
skipping.

## Assets

`gpcl6.wasm` is emitted as `dist/assets/gpcl6.wasm`, with resident PCL fonts
under `dist/assets/fonts/`. The GhostPDL JavaScript loader is bundled.

If your app serves package assets from a different URL, pass `assetBaseUrl`:

```js
const printer = new InkjetEmulator({
  renderer: new GhostPdlRenderer({
    assetBaseUrl: "/vendor/inkjet-emu/assets/",
  }),
});
```
