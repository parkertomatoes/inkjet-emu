export class PclPageDetector {
  static NORMAL = 0;
  static ESCAPE = 1;
  static BINARY = 2;

  constructor() {
    this.state = PclPageDetector.NORMAL;
    this.escape = "";
    this.binaryBytesRemaining = 0;
  }

  /**
   * @param {number} byte
   * @returns {boolean} true when this byte ends a page/job.
   */
  push(byte) {
    byte &= 0xff;

    if(this.state === PclPageDetector.BINARY) {
      this.binaryBytesRemaining--;

      if(this.binaryBytesRemaining <= 0) {
        this.state = PclPageDetector.NORMAL;
      }

      return false;
    }

    if(this.state === PclPageDetector.ESCAPE) {
      this.escape += String.fromCharCode(byte);

      if(byte >= 0x40 && byte <= 0x5e) {
        this.finishEscape();
      }

      return false;
    }

    if(byte === 0x1b) {
      this.state = PclPageDetector.ESCAPE;
      this.escape = "";
      return false;
    }

    return byte === 0x0c;
  }

  finishEscape() {
    const command = this.escape;

    this.state = PclPageDetector.NORMAL;
    this.escape = "";

    if(command.endsWith("V") && command.startsWith("*b")) {
      this.setBinaryPayloadLength(command, "V");
    }
    else if(command.endsWith("W")) {
      this.setBinaryPayloadLength(command, "W");
    }
  }

  setBinaryPayloadLength(command, terminator) {
    const match = command.match(new RegExp(`([-+]?\\d+)${terminator}$`));
    const length = match ? Number(match[1]) : 0;

    if(length > 0) {
      this.binaryBytesRemaining = length;
      this.state = PclPageDetector.BINARY;
    }
  }
}
