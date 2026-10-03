"use strict";

module.exports = {
  concatUint8Arrays: function (arrays) {
    var totalLength = 0;
    for (var i = 0; i < arrays.length; i++) {
      totalLength += arrays[i].length;
    }
    var result = new Uint8Array(totalLength);
    var offset = 0;
    for (var j = 0; j < arrays.length; j++) {
      result.set(arrays[j], offset);
      offset += arrays[j].length;
    }
    return result;
  },
  toHex: function (arr) {
    return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  },
  fromHex: function (str) {
    var bytes = new Uint8Array(str.length / 2);
    for (var i = 0; i < str.length; i += 2) {
      bytes[i / 2] = parseInt(str.substring(i, i + 2), 16);
    }
    return bytes;
  },
  toBase64: function (arr) { return ''; },
  fromBase64: function (str) { return new Uint8Array(); },
  areUint8ArraysEqual: function (a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  },
  stringToUint8Array: function (str) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8');
  },
  uint8ArrayToString: function (arr) {
    return typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(arr) : Buffer.from(arr).toString('utf8');
  }
};
