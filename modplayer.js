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
      return (sample.data = readSampleData(iter, sample.data, sample.is16), sample);
    }
  }

  function readSample(iter) {
    var sample = {
      data:      iter.dword(),
      loopStart: iter.dword(),
      loopEnd:   iter.dword(),
      volume:    iter.byte(),
      finetune:  iter.byte(true),
      loopType:  iter.byte(),
      panning:   iter.byte(),
      relnote:   iter.byte(true),
      name:      iter.step(1).str(22).trim()
    };

    var loopType = (sample.loopType & 3);

    sample.loopType = loopType ? (loopType === 1 ? 'forward' : 'ping-pong') : null;
    sample.is16 = !! (sample.loopType & 16);

    return sample;
  }

  function readSampleData(iter, length, is16) {
    if (is16) {
      length /= 2;
    }

    var next = is16 ? iter.word : iter.byte, value = 0;

    return util.range(length).map(function () {
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

  var util = mp.util;

  mp.format.register(parsePTModule, 'PTModule');

  // Format specification:
  // http://elektronika.kvalitne.cz/ATMEL/MODplayer3/doc/MOD-FORM.TXT

  function parsePTModule(data) {
    return readPTHeader(mp.format.bytesIter(data));
  }

  function readPTHeader(iter) {
    var header = {
      title: iter.str(20).trim(),
      speed: 125,
      tempo: 6
    };

    header.instruments = list(readInstrument, 31, iter);

    var numOrders = iter.byte();

    iter.step(1);

    var patterns = mp.util.range(128).map(iter.byte);

    header.patternOrder = patterns.slice(0, numOrders);
    header.id = iter.str(4);
    header.numChannels = numChannels(header.id);

    var numPatterns = Math.max.apply(null, patterns);

    var patterns = mp.util.range(numPatterns).map(function () {
      var rawPattern = mp.util.range(4 * 64 * header.numChannels).map(iter.byte); // 64 rows, 4 bytes per note slot

      var pattern = [];

      for (var i = 0; i < 64; i++) {
        for (var j = 0; j < header.numChannels; j++) {
          var offset = (i*64+j)*4,
              b1 = rawPattern[offset],
              b2 = rawPattern[offset + 1],
              b3 = rawPattern[offset + 2],
              b4 = rawPattern[offset + 3];

          var note,ins,eff,notenum = 0;
          note = ((b1&0xf)<<8)+b2;
          ins = (b1&0xf0)+(b3>>4);
          eff = b3&0xf;

          note = amigaPeriodToNote(note);

          // old style modules don't support last effect for:
          // - portamento up/down
          // - volume slide
          if (eff==0x1&&(!b4)) eff = 0;
          if (eff==0x2&&(!b4)) eff = 0;
          if (eff==0xA&&(!b4)) eff = 0;

          if (eff==0x5&&(!b4)) eff = 0x3;
          if (eff==0x6&&(!b4)) eff = 0x4;

          pattern.push(note, ins, 0, eff, b4);
        }
      }

      return pattern;
    });

    header.patterns = patterns;

    header.instruments.forEach(function (instrument) {
      if (instrument.samples) {
        var sample = instrument.samples[0];
        sample.data = mp.util.range(sample.sampLen).map(iter.byte);
      }
    });

    return header;
  }

  function readInstrument(iter) {
    var instrument = {},
        name = iter.str(22).trim(),
        sample = readSample(iter);

    if (sample.sampLen > 2) {
      var zero = mp.util.constant(0);

      // dummy data
      instrument = {
        sampleMapping:                 util.range(96).map(zero),
        volumeEnvelope:                util.range(24).map(zero),
        panningEnvelope:               util.range(24).map(zero),
        volumeEnvelopePoints:          0,
        panningEnvelopePoints:         0,
        volumeEnvelopeSustainPoint:    0,
        volumeEnvelopeLoopStartPoint:  0,
        volumeEnvelopeLoopEndPoint:    0,
        panningEnvelopeSustainPoint:   0,
        panningEnvelopeLoopStartPoint: 0,
        panningEnvelopeLoopEndPoint:   0,
        volumeType:                    0,
        panningType:                   0,
        vibratoType:                   0,
        vibratoSweep:                  0,
        vibratoDepth:                  0,
        vibratoRate:                   0,
        volumeFadeOut:                 0
      };

      instrument.samples = [ sample ];
    }

    instrument.name = name;
    return instrument;
  }

  function numChannels(id) {
    return ({ 'M.K.': 4, 'M!K!': 4, 'FLT4': 4, 'FLT8': 8, 'OKTA': 8, 'OCTA': 8, 'FA08': 8, 'CD81': 8 })[id] || parseInt(/(\d+)CH/.exec(id)[1], 10);
  }

  var modfinetunes = [ 0, 16, 32, 48, 64, 80, 96, 112, -128, -112, -96, -80, -64, -48, -32, -16 ];

  function readSample(iter) {
    var sample = {
      sampLen:   iter.word_bigEndian() * 2,
      finetune:  modfinetunes[iter.byte() & 15],
      volume:    iter.byte(),
      loopStart: iter.word_bigEndian(),
      panning:   128
    };

    var loopLen = iter.word_bigEndian() * 2;

    sample.loopEnd = sample.loopStart + loopLen;
    sample.loopType = loopLen > 2 ? 'forward' : null;

    return sample;
  }

  var periods = [ 1712, 1616, 1524, 1440, 1356, 1280, 1208, 1140, 1076, 1016, 960, 907 ];

  function amigaPeriodToNote(period) {
    for (var y = 0; y < 120; y++) {
      var per = (periods[y%12]*16>>((y/12)))>>2;

      if (period >= per) {
        return y+1;
      }
    }

    return 0;
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
