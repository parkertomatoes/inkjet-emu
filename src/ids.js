const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomId(length = 16) {
  const cryptoObject = globalThis.crypto;
  const bytes = new Uint8Array(length);

  if(cryptoObject && typeof cryptoObject.getRandomValues === "function") {
    cryptoObject.getRandomValues(bytes);
  }
  else {
    for(let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let id = "";

  for(const byte of bytes) {
    id += alphabet[byte % alphabet.length];
  }

  return id;
}
