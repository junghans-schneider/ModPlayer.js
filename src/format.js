(function (mp) {
  'use strict';

  var format = mp.format = {},
      util = mp.util;

  var parsers = [];

  format.register = function (parse, name) {
    parsers.push(parse);

    if (name) {
      format['parse' + name] = parse;
    }
  };

  format.parseModule = function (data) {
    var res = null, i = 0;

    while (! res && i < parsers.length) {
      res = parsers[i++](data);
    }

    return res;
  };

  format.bytesIter = function (bytes, offset) {
    offset = offset || 0;

    var iter = { pos: pos, step: step, str: str },
        numbers = { byte: 1, word: 2, dword: 4 };

    iter.word_bigEndian = word_bigEndian;

    Object.keys(numbers).forEach(function (key, length) {
      iter[key] = int.bind(null, numbers[key]);
    });

    return iter;

    // Returns the current offset
    function pos() {
      return offset;
    }

    // Move the offset without reading something
    function step(n) {
      offset += Math.abs(n);
      return iter;
    }

    // Read a string with the given length
    function str(length) {
      return String.fromCharCode.apply(null, bytes.subarray(offset, offset += length));
    }

    // Assemble an integer out of `length` bytes
    function int(length, signed) {
      signed = (signed === true);

      var res = util.range(length).reduce(function (res, i) {
        var byte = bytes[offset + i];
        if (! signed || i + 1 === length) {
          byte &= 0xff;
        }
        return res + (byte << (8 * i));
      }, 0);

      offset += length;
      return res;
    }

    function word_bigEndian() {
      return ((iter.byte() << 8) + iter.byte());
    }
  };

})(window.ModPlayer);
