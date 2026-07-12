export function concatUint8Arrays(arrays) {
  const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for(const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

export function toUint8Array(values) {
  if(values instanceof Uint8Array) {
    return values;
  }

  return new Uint8Array(values);
}
