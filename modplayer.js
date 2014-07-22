(function (win) {
  'use strict';

  if (! Array.from) {
    Array.from = function (arrayLike) {
      return [].slice.call(arrayLike);
    };
  }

  var mp;

  function ModPlayer(buffer) {
    mp.util.extend(this, mp.format.parseModule(new Int8Array(buffer)));
  }

  var previous = win.ModPlayer;

  mp = win.ModPlayer = ModPlayer;

  mp.noConflict = function () {
    return (win.ModPlayer = previous, mp);
  };

  mp.get = function (url, done) {
    mp.util.get(url, 'arraybuffer', function (err, res) {
      done(err, err ? null : new ModPlayer(res));
    });
  };

})(window);

(function (mp) {
  'use strict';

  var util = mp.util = {};

  util.constant = function (value) {
    return function () { return value; };
  };

  // Copies all of the properties in the source object over to
  // the destination object, and returns the destination object.
  util.extend = function (dest, src) {
    for (var x in src) {
      dest[x] = src[x];
    }

    return dest;
  };

  // Flattens a nested array (first nesting level).
  util.flatten = function (array) {
    return [].concat.apply([], array);
  };

  util.pick = function (obj, keys) {
    if (! Array.isArray(keys)) {
      keys = Array.from(arguments).slice(1);
    }

    return keys.reduce(function (res, key) {
      return (res[key] = obj[key], res);
    }, {});
  };

  // Creates a list of integers from 0 to stop, exclusive.
  util.range = function (stop) {
    return Array.apply(null, new Array(stop)).map(function (x, i) { return i; });
  };

  util.startsWith = function (str, substr) {
    return (str.indexOf(substr) === 0);
  };

  /**
   * GETs the given URL.
   *
   * @param {String} url The URL to get
   * @param {String} [type='json'] The expected `responseType`
   * @param {Function} done The callback with `err` and `res` arguments
   */
  util.get = function (url, type, done) {
    if (! done) {
      done =  type;
      type = 'json';
    }

    var isText = (type === 'text' || ! type),
        isJSON = (type === 'json');

    var xhr = util.extend(new XMLHttpRequest(), {

      responseType: isJSON ? '' : type, // Chrome doesn't support responseType='json'

      onload: function () {
        done(null, isText ? xhr.responseText : (isJSON ? eval('(' + xhr.responseText + ')') : xhr.response));
      },

      onerror: function () {
        done(xhr);
      }

    });

    xhr.open('GET', url);
    xhr.send();
  };

})(window.ModPlayer);

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
  };

})(window.ModPlayer);

(function (mp) {
  'use strict';

  var util = mp.util;

  mp.format.register(parseXModule, 'XModule');

  // Format specification:
  // ftp://ftp.modland.com/pub/documents/format_documentation/FastTracker%202%20v2.04%20%28.xm%29.html

  function parseXModule(data) {
    if (! isXModule(data)) {
      return null;
    }

    var iter = mp.format.bytesIter(data),
        header = readHeader(iter),
        module;

    return util.extend(header, {
      patterns:    list(readPattern, header.patterns, iter, header.numChannels),
      instruments: list(readInstrument, header.instruments, iter)
    });
  }

  function isXModule(data) {
    return (mp.format.bytesIter(data).str(17) === 'Extended Module: ');
  }

  function readHeader(iter) {
    var header = {
      id:           iter.str(17),
      title:        iter.str(20).trim(),
      tracker:      iter.step(1).str(20).trim(),
      ver:          iter.word(),
      patternOrder: iter.step(4).word(),
      restart:      iter.word(),
      numChannels:  iter.word(),
      patterns:     iter.word(),
      instruments:  iter.word(),
      freqTable:   (iter.word() & 1) ? 'linear' : 'amiga',
      tempo:        iter.word(),
      speed:        iter.word()
    };

    header.patternOrder = util.range(256).map(iter.byte).slice(0, header.patternOrder);
    return header;
  }

  function readPattern(iter, numChannels) {
    var numRows;

    iter.step(5);
    numRows = iter.word();
    iter.step(2);

    return util.flatten(list(readChannel, numRows * numChannels, iter));
  }

  function readChannel(iter) {
    var mask = iter.byte(), note, ins, vol, fx, op;

    if (mask & 128) {
      note = ins = vol = fx = op = 0;

      if (mask &  1) { note = iter.byte(); }
      if (mask &  2) { ins  = iter.byte(); }
      if (mask &  4) { vol  = iter.byte(); }
      if (mask &  8) { fx   = iter.byte(); }
      if (mask & 16) { op   = iter.byte(); }
    } else {
      note = mask;
      ins  = iter.byte();
      vol  = iter.byte();
      fx   = iter.byte();
      op   = iter.byte();
    }

    return [ note, ins, vol, fx, op ];
  }

  function readInstrument(iter) {
    var instrument = {},
        start = iter.pos(),
        size = iter.dword(),
        name = iter.str(22).trim(),
        numSamples = iter.step(1).word();

    if (numSamples > 0) {
      iter.step(4);

      instrument = {
        sampleMapping:                 util.range(96).map(iter.byte),
        volumeEnvelope:                util.range(24).map(iter.word),
        panningEnvelope:               util.range(24).map(iter.word),
        volumeEnvelopePoints:          iter.byte(),
        panningEnvelopePoints:         iter.byte(),
        volumeEnvelopeSustainPoint:    iter.byte(),
        volumeEnvelopeLoopStartPoint:  iter.byte(),
        volumeEnvelopeLoopEndPoint:    iter.byte(),
        panningEnvelopeSustainPoint:   iter.byte(),
        panningEnvelopeLoopStartPoint: iter.byte(),
        panningEnvelopeLoopEndPoint:   iter.byte(),
        volumeType:                    iter.byte(),
        panningType:                   iter.byte(),
        vibratoType:                   iter.byte(),
        vibratoSweep:                  iter.byte(),
        vibratoDepth:                  iter.byte(),
        vibratoRate:                   iter.byte(),
        volumeFadeOut:                 iter.word()
      };

      iter.step(size - (iter.pos() - start));

      instrument.samples = list(readSample, numSamples, iter).map(addData);
    }

    instrument.name = name;
    return instrument;

    function addData(sample) {
      return (sample.data = readSampleData(iter, sample.sampLen, sample.is16), sample);
    }
  }

  function readSample(iter) {
    var sample = {
      sampLen:   iter.dword(),
      loopStart: iter.dword(),
      loopEnd:   iter.dword(),
      volume:    iter.byte(),
      finetune:  iter.byte(true),
      loopType:  iter.byte(),
      panning:   iter.byte(),
      relnote:   iter.byte(true),
      name:      iter.step(1).str(22).trim()
    };

    sample.is16 = !! (sample.loopType & 16);
    // var loopType = (sample.loopType & 3);
    // sample.loopType = loopType ? (loopType === 1 ? 'forward' : 'ping-pong') : null;

    return sample;
  }

  function readSampleData(iter, sampLen, is16) {
    if (is16) {
      sampLen /= 2;
    }

    var next = is16 ? iter.word : iter.byte, value = 0;

    return util.range(sampLen).map(function () {
      value +=  next();
      value &= (is16 ? 0xffff : 0xff);

      if (is16) {
        if (value >= 32768) { value -= 65536; }
      } else {
        if (value >= 128) { value -= 256; }
      }

      return value;
    });
  }

  function list(read, n, iter) {
    var args = Array.from(arguments).slice(2);
    return util.range(n).map(function () {
      return read.apply(this, args);
    });
  }

})(window.ModPlayer);

(function (mp) {
  'use strict';

  mp.util.extend(mp.prototype, {

    getPattern: function (index) {
      return this.patterns[this.patternOrder[index]];
    },

    numPatterns: function () {
      return this.patternOrder.length;
    },

    toJSON: function () {
      return mp.util.pick(this, Object.keys(this).filter(isPublic));

      function isPublic(key) {
        return ! mp.util.startsWith(key, '_');
      }
    }

  });

})(window.ModPlayer);
