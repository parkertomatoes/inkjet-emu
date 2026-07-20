export type GhostPclStreamOptions = {
  thumbnail_ppi: number;
  on_page_eject: (thumbnail: Uint8Array) => void;
};

export class GhostPclStream {
  constructor(options: GhostPclStreamOptions);

  /** initialize */
  start(): Promise<void>;

  /** push a byte, possibly triggering on_page_eject */
  push(value: number): void;

  /** close stream and return the PDF */
  stop(): Promise<Uint8Array>;
}
