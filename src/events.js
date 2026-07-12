export class EventEmitter {
  constructor() {
    this.handlers = new Set();
  }

  on(handler) {
    if(typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }

    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(value) {
    for(const handler of [...this.handlers]) {
      handler(value);
    }
  }
}
