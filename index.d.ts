/**
 * Handler for when the printer drives the parallel port status lines
 * @param value Value of the status register
 */
export type InkjetEmulatorReceiveStatusHandler = (value: number) => void;

/**
 * Handler for when the printer ejects a page
 * @param thumbnail PNG of the thumbnail of the page
 */
export type InkjetEmulatorEjectPageHandler = (thumbnail: Uint8Array) => void;

/**
 * InkjetEmulator options.
 */
export type InkjetEmulatorOptions = {
  /**
   * Resolution (pixels per inch) to use for PNG thumbnails.
   */
  thumbnail_ppi: number;

  /**
   * Handler for when the printer drives the parallel port status lines.
   */
  on_receive_status: InkjetEmulatorReceiveStatusHandler;

  /**
   * Handler for when the printer ejects a page.
   */
  on_page_eject: InkjetEmulatorEjectPageHandler;
};

/**
 * Virtual PCL 3 compatible printer device.
 */
export class InkjetEmulator {
  /**
   * Initialize the printer - immediately latches idle parallel port status.
   * @param options Printer options.
   */
  constructor(options: InkjetEmulatorOptions);

  /**
   * Latch data on the parallel port data lines
   * @param value data register value
   */
  send_data(value: number): void;

  /**
   * Drive the parallel port control lines
   * @param value control register value
   */
  send_control(value: number): void;

  /**
   * Flush print queue and generate PDF of its contents.
   */
  collect_pdf(): Promise<Uint8Array>;
}
