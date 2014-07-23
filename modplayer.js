(function (win) {
  'use strict';

  if (! Array.from) {
    Array.from = function (arrayLike) {
      return [].slice.call(arrayLike);
    };
  }

  var previous = win.mp, mp;

  mp = win.mp = {};

  mp.noConflict = function () {
    return (win.mp = previous, mp);
  };

  mp.loadModule = function (url, args, done) {
    args = Array.from(arguments).slice(1);
    done = args.pop();

    mp.util.get(url, 'arraybuffer', function (err, res) {
      done(err, err ? null : mp.module.apply(null, [ res ].concat(args)));
    });
  };

})(window);

(function (mp) {
  'use strict';

  var util = mp.util = {};

  // Creates a function that returns the value.
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

  // Creates a list of integers from 0 to stop, exclusive.
  util.range = function (stop) {
    return Array.apply(null, new Array(stop)).map(function (x, i) { return i; });
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

})(window.mp);

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

})(window.mp);

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
        header = readHeader(iter);

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
      data:       iter.dword(),
      loopStart:  iter.dword(),
      loopLength: iter.dword(),
      volume:     iter.byte(),
      finetune:   iter.byte(true),
      loopType:   iter.byte(),
      panning:    iter.byte(),
      relnote:    iter.byte(true),
      name:       iter.step(1).str(22).trim()
    };

    var loopType = (sample.loopType & 3);

    sample.is16 = !! (sample.loopType & 16);
    sample.loopType = loopType ? (loopType === 1 ? 'forward' : 'ping-pong') : null;

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

})(window.mp);

(function (mp) {
  'use strict';

  var util = mp.util;

  mp.format.register(parsePTModule, 'PTModule');

  // Format specification:
  // http://elektronika.kvalitne.cz/ATMEL/MODplayer3/doc/MOD-FORM.TXT

  // Code derived from:
  // https://github.com/Deltafire/MilkyTracker/blob/master/src/milkyplay/LoaderMOD.cpp

  function parsePTModule(data) {
    var iter = mp.format.bytesIter(data);

    var module = {
      title:       iter.str(20).trim(),
      instruments: list(readInstrument, 31, iter),
      speed:       125,
      tempo:       6
    };

    var patternOrderLength = iter.byte(),
        patternOrder = mp.util.range(128).map(iter.step(1).byte),
        numPatterns = Math.max.apply(null, patternOrder) + 1;

    module.patternOrder = patternOrder.slice(0, patternOrderLength);
    module.id           = iter.str(4);
    module.numChannels  = numChannels(module.id);
    module.patterns     = list(readPattern, numPatterns, iter, module.numChannels);

    module.instruments.forEach(function (instrument) {
      var sample = instrument.samples && instrument.samples[0];

      if (sample) {
        sample.data = readSampleData(iter, sample.length);
      }
    });

    return module;
  }

  function readInstrument(iter) {
    var instrument = {},
        name = iter.str(22).trim(),
        sample = readSample(iter);

    if (sample.length > 2) {
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

  var modfinetunes = [ 0, 16, 32, 48, 64, 80, 96, 112, -128, -112, -96, -80, -64, -48, -32, -16 ];

  function readSample(iter) {
    var sample = {
      length:     iter.word_bigEndian() * 2,
      finetune:   modfinetunes[iter.byte() & 15],
      volume:     iter.byte(),
      loopStart:  iter.word_bigEndian() * 2,
      loopLength: iter.word_bigEndian() * 2,
      panning:    128,
      relnote:    0
    };

    sample.loopType = sample.loopEnd > 2 ? 'forward' : null;
    return sample;
  }

  function readSampleData(iter, length) {
    return mp.util.range(length).map(function () {
      var value = iter.byte();
      if (value >= 128) { value -= 256; }
      return value;
    });
  }

  function numChannels(id) {
    return ({ 'M.K.': 4, 'M!K!': 4, 'FLT4': 4, 'FLT8': 8, 'OKTA': 8, 'OCTA': 8, 'FA08': 8, 'CD81': 8 })[id] || parseInt(/(\d+)CH/.exec(id)[1], 10);
  }

  function readPattern(iter, numChannels) {
    return mp.util.flatten(list(readChannel, 64 * numChannels, iter)); // 64 rows
  }

  function readChannel(iter) {
    var b1 = iter.byte(),
        b2 = iter.byte(),
        b3 = iter.byte(),
        b4 = iter.byte();

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

    return [ note, ins, 0, eff, b4 ];
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

})(window.mp);

(function (mp) {
  'use strict';

  mp.instrument = function(soundUtil, ticksPerRow, instrumentData) {

    var fadeVolumeStart = 32767;

    var samples = [];

    if (instrumentData.samples) {
      samples = instrumentData.samples.map(mp.sample.bind(null, soundUtil.audioContext));
    }

    // prepare volume envelope
    var envelopePoints = [];
    var envelopePointCount = instrumentData.volumeEnvelopePoints || 0;
    var sustainPos = -1;
    var loopStartPos = -1;
    var loopEndPos = -1;
    if (instrumentData.volumeType&1) {
      var previousPos = -1;
      var previousValue = 64;
      for (var i = 0; i < envelopePointCount; ++i) {
        var pos = instrumentData.volumeEnvelope[i*2];
        var value = instrumentData.volumeEnvelope[i*2 + 1];
        for (var j = previousPos + 1; j < pos; ++j) {
          envelopePoints[j] = previousValue +
            (value - previousValue)*(j - previousPos)/(pos - previousPos);
        }
        envelopePoints[pos] = value;
        if (instrumentData.volumeEnvelopeSustainPoint == i &&
            (instrumentData.volumeType&2)) {
          sustainPos = pos;
        }
        if (instrumentData.volumeEnvelopeLoopStartPoint == i &&
            (instrumentData.volumeType&4)) {
          loopStartPos = pos;
        }
        if (instrumentData.volumeEnvelopeLoopEndPoint == i &&
            (instrumentData.volumeType&4)) {
          loopEndPos = pos;
        }
        previousPos = pos;
        previousValue = value;
      }
    }

    // prepare panning envelope
    var panningEnvelopePoints = [];
    var panningEnvelopePointCount = instrumentData.panningEnvelopePoints || 0;
    var panningSustainPos = -1;
    var panningLoopStartPos = -1;
    var panningLoopEndPos = -1;
    if (instrumentData.panningType&1) {
      var previousPos = -1;
      var previousValue = 32;
      for (var i = 0; i < panningEnvelopePointCount; ++i) {
        var pos = instrumentData.panningEnvelope[i*2];
        var value = instrumentData.panningEnvelope[i*2 + 1];
        for (var j = previousPos + 1; j < pos; ++j) {
          panningEnvelopePoints[j] = previousValue +
            (value - previousValue)*(j - previousPos)/(pos - previousPos);
        }
        panningEnvelopePoints[pos] = value;
        if (instrumentData.panningEnvelopeSustainPoint == i &&
            (instrumentData.panningType&2)) {
          panningSustainPos = pos;
        }
        if (instrumentData.panningEnvelopeLoopStartPoint == i &&
            (instrumentData.panningType&4)) {
          panningLoopStartPos = pos;
        }
        if (instrumentData.panningEnvelopeLoopEndPoint == i &&
            (instrumentData.panningType&4)) {
          panningLoopEndPos = pos;
        }
        previousPos = pos;
        previousValue = value;
      }
    }

    return {
      getSample: getSample,
      doFrequencyTick: doFrequencyTick,
      doVolumeTick: doVolumeTick,
      stopNoteAtTime: stopNoteAtTime
    };

    function getSample(note) {
      return samples[instrumentData.sampleMapping[note - 1]];
    }

    function calculateVolume(fadeVolume, noteVolume, envelopeVolume) {
      var volume = (fadeVolume/fadeVolumeStart)*(noteVolume/64)*(envelopeVolume/64);
      return volume;
    }

    function calculatePanning(notePanning, envelopePanning) {
      var panning = notePanning +
        (envelopePanning - 32)*(128 - Math.abs(notePanning - 128))/32;
      if (panning < 0) {
        panning = 0;
      } else if (panning > 255) {
        panning = 255;
      }
  //console.log("calculatePanning: " + notePanning + ", " + envelopePanning + " => " + panning);
      return panning/255;
    }

    function smoothlySetVolumeAtTime(leftGainNode, rightGainNode,
                                     state, volume, panning, time, factor) {
      var volumeLeft = volume*Math.cos(Math.PI/2*panning);
      var volumeRight = volume*Math.sin(Math.PI/2*panning);
      if (volumeLeft != state.volumeLeft) {
        if (state.volumeLeft == null) {
          leftGainNode.gain.value = 0;
          soundUtil.smoothlySetValueAtTime(
            leftGainNode.gain, 0, volumeLeft, time, factor);
        } else {
          soundUtil.smoothlySetValueAtTime(
            leftGainNode.gain, state.volumeLeft, volumeLeft, time, factor);
        }
        state.volumeLeft = volumeLeft;
      }
      if (volumeRight != state.volumeRight) {
        if (state.volumeRight == null) {
          rightGainNode.gain.value = 0;
          soundUtil.smoothlySetValueAtTime(
            rightGainNode.gain, 0, volumeRight, time, factor);
        } else {
          soundUtil.smoothlySetValueAtTime(
            rightGainNode.gain, state.volumeRight, volumeRight, time, factor);
        }
        state.volumeRight = volumeRight;
      }
    }

    function doFrequencyTick(state, note, arpeggio, portamento, portamentoTarget,
                             bufferNode, tickStartTime, tickEndTime) {

      // initialize state for tick
      var sample = getSample(note);
      if (state == null) {
        state = {};
        if (instrumentData.vibratoRate && instrumentData.vibratoDepth) {
          state.autoVibratoPos = 0;
          if (instrumentData.vibratoSweep) {
            state.autoVibratoSweepPos = 0;
          }
        }
      }

      // intialize effects
      if (arpeggio != null) {
        state.arpeggio = arpeggio;
        state.arpeggioPos = 0;
      }
      if (portamento != null) {
        state.portamento = portamento;
        state.portamentoPos = 0;
        if (portamentoTarget != null) {
          var portamentoSample = getSample(portamentoTarget);
          state.portamentoTarget =
            portamentoSample.getBasePlaybackRate()*Math.pow(
              2, (portamentoTarget - 49)/12);
  //console.log("state.portamento: " + state.portamento);
  //console.log("state.portamentoTarget: " + state.portamentoTarget);
  //console.log("state.basePlaybackRate: " + state.basePlaybackRate);
          if (state.portamentoTarget < state.basePlaybackRate) {
            if (state.portamento > 0) {
              state.portamento *= -1;
            }
          } else {
            if (state.portamento < 0) {
              state.portamento *= -1;
            }
          }
        } else {
          state.portamentoTarget = null;
        }
      }

      // calculate playback rate
      var effectivePlaybackRate = state.basePlaybackRate;
      if (effectivePlaybackRate == null) {
        effectivePlaybackRate = sample.getBasePlaybackRate();
        effectivePlaybackRate *= Math.pow(2, (note - 49)/12);
        state.basePlaybackRate = effectivePlaybackRate;
      }
      if (state.arpeggio != null) {
        if (state.arpeggioPos%3 == 1) {
          effectivePlaybackRate =
            state.basePlaybackRate*Math.pow(2, (state.arpeggio&0x0F)/12);
        } else if (state.arpeggioPos%3 == 2) {
          effectivePlaybackRate =
            state.basePlaybackRate*Math.pow(2, ((state.arpeggio&0xF0)/16)/12);
        } else {
          effectivePlaybackRate = state.basePlaybackRate;
        }
        ++state.arpeggioPos;
        if (state.arpeggioPos >= ticksPerRow) {
          state.arpeggio = null;
        }
      }
      if (state.portamento != null) {
        ++state.portamentoPos;
        if (state.portamentoPos >= ticksPerRow) {
          state.portamento = null;
        } else {
          state.basePlaybackRate *= Math.pow(2, (state.portamento/16)/12);
          if (state.portamentoTarget != null) {
  //console.log(state.basePlaybackRate + " ==(" + state.portamento + ")==> " + state.portamentoTarget);
            if ((state.basePlaybackRate <= state.portamentoTarget &&
                 state.portamento < 0) ||
                (state.basePlaybackRate >= state.portamentoTarget &&
                 state.portamento > 0)) {
              state.basePlaybackRate = state.portamentoTarget;
              state.portamento = null;
            }
          }
        }
      }
      if (instrumentData.vibratoRate && instrumentData.vibratoDepth) {
        var value = Math.sin(Math.PI*2*state.autoVibratoPos/256);
          // TODO: add other curves
        var relNote = value*instrumentData.vibratoDepth/64;
        if (instrumentData.vibratoSweep) {
          relNote *= state.autoVibratoSweepPos/instrumentData.vibratoSweep;
        }
        effectivePlaybackRate *= Math.pow(2, relNote/12);
        state.autoVibratoPos += instrumentData.vibratoRate;
        if (instrumentData.vibratoSweep &&
            state.autoVibratoSweepPos < instrumentData.vibratoSweep) {
          ++state.autoVibratoSweepPos;
        }
      }

      // apply playback rate
      if (effectivePlaybackRate != state.playbackRate) {
        if (state.playbackRate == null) {
          bufferNode.playbackRate.value = effectivePlaybackRate;
        } else {
          bufferNode.playbackRate.setValueAtTime(
            effectivePlaybackRate, tickStartTime);
        }
        state.playbackRate = effectivePlaybackRate;
  var tickDuration = tickEndTime - tickStartTime;
  //console.log("bufferNode.setValueAtTime: " + effectivePlaybackRate/sample.getBasePlaybackRate() + ", " + tickStartTime/tickDuration);
      }

      return state;
    }

    function doVolumeTick(state, note,
                          noteVolume, volumeSlide, jumpToEnvelopePos,
                          notePanning,
                          leftGainNode, rightGainNode,
                          tickStartTime, tickEndTime) {

      // initialize state for tick
      var sample = getSample(note);
  //console.log("sample: " + sample);
      var keyOff = (note == 97);
      if (state == null) {
        state = {
          fadeVolume:fadeVolumeStart, volumeSlide:0,
          envelopePos:0, panningEnvelopePos:0, keyOff:false
        };
      }
      if (keyOff) {
        state.keyOff = true;
      } else if (note >= 1 && note <= 96) {
        state.keyOff = false;
        state.fadeVolume = fadeVolumeStart;
      }
      if (noteVolume != null) {
        state.envelopePos = 0;
      }
      if (volumeSlide != null) {
        state.volumeSlide = volumeSlide;
        state.volumeSlidePos = 0;
      }
      if (jumpToEnvelopePos != null) {
        state.envelopePos = jumpToEnvelopePos;
      }
      if (notePanning != null) {
        state.panningEnvelopePos = 0;
      }

      // calculate panning
      var effectiveNotePanning = notePanning;
      if (effectiveNotePanning == null) {
        if (state.notePanning != null) {
          effectiveNotePanning = state.notePanning;
        } else {
          effectiveNotePanning = sample.getBasePanning();
        }
      }
      state.notePanning = effectiveNotePanning;

      // calculate envelope panning
      var panning;
      if ((instrumentData.panningType&1) == 0) {
        panning = calculatePanning(effectiveNotePanning, 32);
      } else {
        var envelopePanning = panningEnvelopePoints[state.panningEnvelopePos];
        if (envelopePanning == null) {
          envelopePanning = state.envelopePanning;
        }
        if (envelopePanning == null) {
          envelopePanning = 32;
        }
        state.envelopePanning = envelopePanning;
        panning = calculatePanning(effectiveNotePanning, envelopePanning);
        if (state.panningEnvelopePos != panningSustainPos) {
          ++state.panningEnvelopePos;
          if (state.panningEnvelopePos == panningLoopEndPos) {
            state.panningEnvelopePos = panningLoopEndPos;
          }
        }
      }

      // calculate note volume
      var effectiveNoteVolume = noteVolume;
      if (effectiveNoteVolume == null) {
        if (state.noteVolume != null) {
          effectiveNoteVolume = state.noteVolume;
        } else {
          effectiveNoteVolume = sample.getBaseVolume();
        }
      }
      state.noteVolume = effectiveNoteVolume;
  //console.log("effectiveNoteVolume: " + effectiveNoteVolume);

      // calculate envelope volume
      if ((instrumentData.volumeType&1) == 0) {
        var volume = (keyOff ? 0 :
                      calculateVolume(fadeVolumeStart, effectiveNoteVolume, 64));
        smoothlySetVolumeAtTime(leftGainNode, rightGainNode,
                                state, volume, panning, tickStartTime);
      } else {
        var envelopeVolume = envelopePoints[state.envelopePos];
  //if (state.keyOff) envelopeVolume = 0;
  //console.log("envelopeVolume: " + envelopeVolume + "@" + state.envelopePos);
        if (envelopeVolume == null) {
          envelopeVolume = state.envelopeVolume;
        }
        if (envelopeVolume == null) {
          envelopeVolume = 64;
        }
        state.envelopeVolume = envelopeVolume;
  //console.log("test: " + state.fadeVolume + ", " + effectiveNoteVolume + ", " + envelopeVolume);
        var volume = calculateVolume(
          state.fadeVolume, effectiveNoteVolume, envelopeVolume);
        smoothlySetVolumeAtTime(leftGainNode, rightGainNode,
                                state, volume, panning, tickStartTime);
        if (state.keyOff || state.envelopePos != sustainPos) {
          ++state.envelopePos;
          if (state.envelopePos == loopEndPos) {
            state.envelopePos = loopStartPos;
          }
        }
        if (state.keyOff) {
          state.fadeVolume -= instrumentData.volumeFadeOut;
          if (state.fadeVolume < 0) {
            state.fadeVolume = 0;
          }
  //console.log("fading: " + state.fadeVolume);
        }
      }

      // apply volume slide
      if (state.volumeSlide != null) {
        ++state.volumeSlidePos;
        var effectiveVolumeSlide = state.volumeSlide;
        var effectiveLimit = ticksPerRow;
        if (Math.abs(effectiveVolumeSlide) < 1) {
          effectiveVolumeSlide *= 256;
          effectiveLimit = 2;
        }
        if (state.volumeSlidePos >= effectiveLimit) {
          state.volumeSlide = null;
        } else {
          state.noteVolume += effectiveVolumeSlide;
          if (state.noteVolume < 0) {
            state.noteVolume = 0;
          } else if (state.noteVolume > 64) {
            state.noteVolume = 64;
          }
        }
      }

      return state;
    }

    function stopNoteAtTime(volumeState, leftGainNode, rightGainNode,
                            sourceNode, time) {
      soundUtil.smoothlySetValueAtTime(
        leftGainNode.gain, volumeState.volumeLeft, 0, time);
      soundUtil.smoothlySetValueAtTime(
        rightGainNode.gain, volumeState.volumeRight, 0, time);
      sourceNode.stop(time + soundUtil.smoothingTime);
  --window.playingNotes;
    }
  };


})(window.mp);

(function (mp) {
  'use strict';

  mp.module = function(data, audioContext) {

    data = mp.format.parseModule(new Int8Array(data));

    var soundUtil = createSoundUtil(audioContext);
    var channelCount = data.numChannels;
    var tickDuration = 2.5/data.speed;
    var ticksPerRow = data.tempo;
    var rowDuration = tickDuration*ticksPerRow;
    var intervalStartTime = null;
    var startTime = null;
    var instruments = data.instruments.map(mp.instrument.bind(null, soundUtil, ticksPerRow));

    return {
      play: play,
      syncWithAudio: syncWithAudio
    };

    function play(destination, timerCallback) {
      if (data == null) {
        return;
      }
      if (startTime != null) {
        return;
      }
      var masterGain = soundUtil.audioContext.createGain();
      masterGain.gain.value = 0.75;
      masterGain.connect(destination);
      var state = null;
      startTime = soundUtil.audioContext.currentTime + 0.03;
      intervalStartTime = startTime;
      var patternTime = startTime;
      //var ordIndex = 0x0E;
      var ordIndex = 0x0;
      var currentPattern = null;
      var rowsAtOnce = 2;
      var processedRows = 0;
      var toCall;
      var playPattern = function() {
  //console.log("playPattern (playing notes: " + window.playingNotes + ")");
        var now = soundUtil.audioContext.currentTime;
        if (currentPattern == null) {
          currentPattern = mp.pattern(soundUtil, masterGain,
            instruments, tickDuration, ticksPerRow, channelCount,
            data.patterns[data.patternOrder[ordIndex]]
          );
        }
        var pattern = currentPattern;
        state = pattern.playPattern(state, patternTime, now, rowsAtOnce);
        processedRows += pattern.getProcessedRows(state);
        patternTime = pattern.getPatternEndTime(state);
        if (pattern.isFinished(state)) {
          currentPattern = null;
          ++ordIndex;
          if (ordIndex >= data.patternOrder.length) {
            ordIndex = (data.restart ? data.restart : 0);
          }
          if (processedRows < rowsAtOnce) {
            playPattern();
            return;
          }
        }
        var patternDuration = patternTime - startTime;
        var waitTime = patternDuration*0.5 + (startTime - now);
        window.setTimeout(toCall, waitTime*1000);
        startTime = patternTime;
      };
      var toCall = playPattern;
      if (timerCallback != null) {
        toCall = function() {
          timerCallback(playPattern);
        }
      }
      playPattern();
    }

    function syncWithAudio(nextIntervalStartTime) {
      if (startTime == null) {
        return null;
      }
      var now = soundUtil.audioContext.currentTime;
      var rowsInInterval = 1;
      var interval = rowDuration*rowsInInterval;
      if (nextIntervalStartTime == null || now > nextIntervalStartTime) {
        var rowCount = Math.round((startTime - intervalStartTime)/rowDuration);
        intervalStartTime = startTime - (rowCount%rowsInInterval + rowsInInterval - 0.25)*rowDuration;
          // correct jitter
        var intervals = Math.round((now - intervalStartTime)/interval);
        nextIntervalStartTime = intervalStartTime + (intervals + 1)*interval;
      }
      return nextIntervalStartTime;
    }
  };

  function createSoundUtil(audioContext) {

    var smoothingTime = 0.004;

    function smoothlySetValueAtTime(audioParam, oldValue, value, time, factor) {
      if (factor == null) factor = 1;
      if (oldValue == null) {
        audioParam.setValueAtTime(value, time);
      } else {
        audioParam.setValueAtTime(oldValue, time);
        audioParam.linearRampToValueAtTime(value, time + smoothingTime*factor);
      }
    }

    return {
      smoothlySetValueAtTime: smoothlySetValueAtTime,

      audioContext: audioContext,
      smoothingTime: smoothingTime
    };
  }

})(window.mp);

(function (mp) {
  'use strict';

  mp.pattern = function(soundUtil, destination, instruments,
                                     tickDuration, ticksPerRow,
                                     channelCount, patternData) {

    function createState() {
      var masterGainNode = soundUtil.audioContext.createGain();
      masterGainNode.connect(destination);
      var state = {
        masterGainNode:masterGainNode,
        channels:[],
        rowIndex: 0,
        loopStartRow: 0,
        loopCounter: 0
      };
      for (var i = 0; i < channelCount; ++i) {
        var channelMergerNode = soundUtil.audioContext.createChannelMerger(2);
        var channelMasterGainNode = soundUtil.audioContext.createGain();
        channelMergerNode.connect(channelMasterGainNode);
        channelMasterGainNode.connect(masterGainNode);
        state.channels.push({ channelMasterGainNode:channelMasterGainNode,
                              channelMergerNode:channelMergerNode,
                              playingNotes:[] });
      }
      return state;
    }

    function muteChannel(state, channel, time) {
      if (state == null) {
        state = createState();
      }
      state.channels[channel].channelMasterGainNode.setValueAtTime(0, time);
      return state;
    }

    function unmuteChannel(state, channel, time) {
      if (state == null) {
        state = createState();
      }
      state.channels[channel].channelMasterGainNode.setValueAtTime(1, time);
      return state;
    }

    function stopPlayingImmediately(state) {
      if (state == null) return;
      for (var i = 0; i < channelCount; ++i) {
        var channelState = state.channels[i];
        var playingNoteCount = channelState.playingNotes.length;
        for (var j = 0; j < playingNoteCount; ++j) {
          var playingNote = channelState.playingNotes[j];
          if (!playingNote.stopped) {
            playingNote.sourceNode.stop(time);
            playingNote.stopped = true;
          }
        }
      }
    }

    function cleanUpState(state, now) {
      for (var i = 0; i < channelCount; ++i) {
        var channelState = state.channels[i];
        var playingNoteCount = channelState.playingNotes.length;
        var deleteCount = 0;
        for (var j = 1; j < playingNoteCount; ++j) {
          var playingNote = channelState.playingNotes[j];
          if (playingNote.startTime < now) {
            deleteCount = j;
          }
        }
        if (deleteCount > 0) {
          channelState.playingNotes.splice(0, deleteCount);
        }
      }
    }

    function playPattern(state, startTime, now, maxRows) {

  //console.log("playPattern: " + patternData.length);
      if (state == null) {
        state = createState();
      } else {
        cleanUpState(state, now);
      }
      state.processedRows = 0;
      if (!maxRows) {
        maxRows = 1000;
      }

      var columnSize = 5;
      var rowSize = columnSize*channelCount;
      var patternRowCount = patternData.length/rowSize;
  //console.log("patternRowCount: " + patternRowCount);
      var tick = 0;

      while (state.rowIndex < patternRowCount && state.processedRows < maxRows) {
  //console.log("rowIndex: " + state.rowIndex);
        var time = startTime + tick*tickDuration;
        var effectiveTicksPerRow = ticksPerRow;
        var globalVolume = state.globalVolume;
        if (globalVolume == null) {
          globalVolume = 64;
        }
        var globalVolumeSlide = null;
        // first pass: stop and start notes, determine tick count
        for (var i = 0; i < channelCount; ++i) {

          var channelState = state.channels[i];

          // process effects that affect the timing
          var baseIndex = state.rowIndex*rowSize + i*columnSize;
          var effect1 = patternData[baseIndex + 3];
          var effect2 = patternData[baseIndex + 4];
          if (effect1 == 0x10) {
            globalVolume = effect2;
            if (globalVolume > 64) {
              globalVolume = 64;
            }
          } else if (effect1 == 0x11) {
            if (effect2 == 0 && channelState.globalVolumeSlideMemory) {
              effect2 = channelState.globalVolumeSlideMemory;
            }
            if (effect2) {
              globalVolumeSlide = (effect2&0xF0)/16;
              if (globalVolumeSlide == 0) {
                globalVolumeSlide = -(effect2&0x0F);
              }
              channelState.globalVolumeSlideMemory = effect2;
            }
          } else if (effect1 == 0xE) {
            if ((effect2&0xF0) == 0xE0) {
              var columnTicksPerRow = ((effect2&0x0F) + 1)*ticksPerRow;
              if (columnTicksPerRow > effectiveTicksPerRow) {
                effectiveTicksPerRow = columnTicksPerRow;
              }
            }
          }

  //if (i != 7) continue;
          var playingNoteCount = channelState.playingNotes.length;
          var note = patternData[baseIndex];
          var instrumentNumber = patternData[baseIndex + 1];
          if (note == 0) {
            if (instrumentNumber != 0 && channelState.noteMemory) {
              note = channelState.noteMemory;
            }
          } else if (note >= 1 && note <= 96) {
            channelState.noteMemory = note;
          }
          if (note >= 1 && note <= 96 && effect1 != 0x3) {
            var instrument = instruments[instrumentNumber - 1];
            var sample = instrument.getSample(note);
  //if (patternData[baseIndex + 1] - 1 == 2) console.log("Sample: " + sample);
            if (playingNoteCount > 0) {
              var playingNote = channelState.playingNotes[playingNoteCount - 1];
              if (!playingNote.stopped) {
                playingNote.instrument.stopNoteAtTime(
                  playingNote.volumeState,
                  playingNote.leftGainNode, playingNote.rightGainNode,
                  playingNote.sourceNode, time
                );
                playingNote.stopped = true;
              }
            }
            var playingNote = {
              instrument: instrument,
              sourceNode: sample.createSampleSourceNode(),
              leftGainNode: soundUtil.audioContext.createGain(),
              rightGainNode: soundUtil.audioContext.createGain()
            };
            playingNote.leftGainNode.connect(channelState.channelMergerNode,
                                             0, 0);
            playingNote.rightGainNode.connect(channelState.channelMergerNode,
                                             0, 1);
            playingNote.sourceNode.connect(playingNote.leftGainNode);
            playingNote.sourceNode.connect(playingNote.rightGainNode);
            var offset = 0;
            if (effect1 == 0x9) {
              if (effect2 == 0 && channelState.sampleOffsetMemory) {
                effect2 = channelState.sampleOffsetMemory;
              }
              if (effect2) {
                offset = sample.getSampleOffsetInSeconds(effect2*256);
                channelState.sampleOffsetMemory = effect2;
              }
            }
            playingNote.sourceNode.start(time, offset);
            channelState.playingNotes.push(playingNote);
          }
        }
        // second pass: tick processing
        for (var rowTick = 0; rowTick < effectiveTicksPerRow; ++rowTick) {
          var tickStartTime = startTime + tick*tickDuration;
          var tickEndTime = startTime + (tick + 1)*tickDuration;
          if (globalVolume != null && globalVolume != state.globalVolume) {
            if (state.globalVolume == null) {
              state.masterGainNode.gain.value = globalVolume/64;
            } else {
              state.masterGainNode.gain.setValueAtTime(globalVolume/64, tickStartTime);
                // Don't set the volume smoothly in this case as the expected
                // behaviour is an immediate effect (and we get artifacts if
                // we try to smooth it).
            }
            state.globalVolume = globalVolume;
          }
          if (globalVolumeSlide != null) {
            globalVolume += globalVolumeSlide;
            if (globalVolume < 0) {
              globalVolume = 0;
            } else if (globalVolume > 64) {
              globalVolume = 64;
            }
          }
          for (var i = 0; i < channelCount; ++i) {
            var channelState = state.channels[i];
            var baseIndex = state.rowIndex*rowSize + i*columnSize;
            var playingNoteCount = channelState.playingNotes.length;
            if (playingNoteCount > 0) {
              var playingNote = channelState.playingNotes[playingNoteCount - 1];
              var note = null;
              var volume = null;
              var panning = null;
              var arpeggio = null;
              var portamento = null;
              var portamentoTarget = null;
              var volumeSlide = null;
              var jumpToEnvelopePos = null;
              if (rowTick == 0) {
                note = patternData[baseIndex];
                var instrumentNumber = patternData[baseIndex + 1];
                if (note == 0 && instrumentNumber != 0 && channelState.noteMemory) {
                  note = channelState.noteMemory;
                }
                volume = patternData[baseIndex + 2];
                if (volume >= 0x10 && volume < 0x60) {
                  volume -= 0x10;
                  if (volume > 64) {
                    volume = 64;
                  }
                } else {
                  if ((volume&0xF0) == 0x80) {
                    volumeSlide = -(volume&0x0F)/256;
                  } else if ((volume&0xF0) == 0xC0) {
                    panning = (volume & 0x0F);
                    panning += panning*0x10;
                  }
                  volume = null;
                }
                var effect = patternData[baseIndex + 3];
                var effectParam = patternData[baseIndex + 4];
                if (effect == 0) {
                  //if (effectParam == 0 && channelState.arpeggioMemory) {
                  //  effectParam = channelState.arpeggioMemory;
                  //}
                  if (effectParam) {
                    arpeggio = effectParam;
                    //channelState.arpeggioMemory = effectParam;
                  }
                } else if (effect == 0x1) {
                  if (effectParam == 0 && channelState.portamentoUpMemory) {
                    effectParam = channelState.portamentoUpMemory;
                  }
                  if (effectParam) {
                    portamento = effectParam;
                    channelState.portamentoUpMemory = effectParam;
                  }
                } else if (effect == 0x2) {
                  if (effectParam == 0 && channelState.portamentoDownMemory) {
                    effectParam = channelState.portamentoDownMemory;
                  }
                  if (effectParam) {
                    portamento = -effectParam;
                    channelState.portamentoDownMemory = effectParam;
                  }
                } else if (effect == 0x3) {
                  if (note == null) {
                    portamentoTarget = channelState.portamentoTargetMemory;
                  } else {
                    portamentoTarget = note;
                    channelState.portamentoTargetMemory = note;
                  }
                  if (effectParam == 0 && channelState.portamentoMemory) {
                    effectParam = channelState.portamentoMemory;
                  }
                  if (effectParam) {
                    portamento = effectParam;
                    channelState.portamentoMemory = effectParam;
                  }
                } else if (effect == 0xA) {
                  if (effectParam == 0 && channelState.volumeSlideMemory) {
                    effectParam = channelState.volumeSlideMemory;
                  }
                  if (effectParam) {
                    volumeSlide = (effectParam&0xF0)/16;
                    if (volumeSlide == 0) {
                      volumeSlide = -(effectParam&0x0F);
                    }
                    channelState.volumeSlideMemory = effectParam;
                  }
                } else if (effect == 0xC) {
                  volume = effectParam;
                  if (volume > 64) {
                    volume = 64;
                  }
                } else if (effect == 0x15) {
                  jumpToEnvelopePos = effectParam;
                }
              }
              playingNote.frequencyState =
                playingNote.instrument.doFrequencyTick(
                  playingNote.frequencyState, note, arpeggio,
                  portamento, portamentoTarget,
                  playingNote.sourceNode,
                  tickStartTime, tickEndTime
                );
              playingNote.volumeState =
                playingNote.instrument.doVolumeTick(
                  playingNote.volumeState, note,
                  volume, volumeSlide, jumpToEnvelopePos, panning,
                  playingNote.leftGainNode, playingNote.rightGainNode,
                  tickStartTime, tickEndTime
                );
            }
          }
          ++tick;
        }

        // third pass: pattern loop handling
        for (var i = 0; i < channelCount; ++i) {
  //continue;
          var channelState = state.channels[i];
          var baseIndex = state.rowIndex*rowSize + i*columnSize;
          var effect1 = patternData[baseIndex + 3];
          if (effect1 == 0xE) {
            var effect2 = patternData[baseIndex + 4];
            if ((effect2&0xF0) == 0x60) {
              var loopCount = (effect2&0x0F);
              if (loopCount == 0) {
                state.loopStartRow = state.rowIndex;
              } else {
                if (state.loopCounter < loopCount) {
                  ++state.loopCounter;
                  state.rowIndex = state.loopStartRow - 1;
                } else {
                  state.loopCounter = 0;
                }
              }
            }
          }
        }

        // advance the row
        ++state.rowIndex;
        ++state.processedRows;
      }

      if (state.rowIndex == patternRowCount) {
        state.rowIndex = 0;
      }
      state.endTime = startTime + tick*tickDuration;
      return state;
    }

    function getPatternEndTime(state) {
      return state.endTime;
    }

    function getProcessedRows(state) {
      return state.processedRows;
    }

    function isFinished(state) {
      return (state.rowIndex == 0);
    }

    return {
      playPattern: playPattern,
      getPatternEndTime: getPatternEndTime,
      getProcessedRows: getProcessedRows,
      isFinished: isFinished,
      muteChannel: muteChannel,
      unmuteChannel: unmuteChannel,
      stopPlayingImmediately: stopPlayingImmediately
    };
  };

})(window.mp);

(function (mp) {
  'use strict';

  mp.sample = function(audioContext, sampleData) {

    var sampleFrequency = 8363;
    var minimumFrequency = 22050;
    var bufferFrequency = (sampleFrequency < minimumFrequency ?
                           minimumFrequency : sampleFrequency);
    var frequencyFactor = sampleFrequency/bufferFrequency;
    var loopStart = sampleData.loopStart;
    var loopLength = sampleData.loopLength;
    var audioBuffer = null;
    var sampleCount;

    var relnote = sampleData.relnote;
    if (relnote >= 128) relnote -= 256;
    var finetune = sampleData.finetune;
    if (finetune >= 128) finetune -= 256;
    frequencyFactor *= Math.pow(2, relnote/12);
    frequencyFactor *= Math.pow(2, finetune/128/12);

    var data = sampleData.data;
    sampleCount = data.length;
    audioBuffer = audioContext.createBuffer(1, sampleCount, bufferFrequency);
    var bufferData = audioBuffer.getChannelData(0);
    var div = (sampleData.is16 ? 32768 : 128);
    for (var i = 0; i < sampleCount; ++i) {
      bufferData[i] = data[i]/div;
    }

    // if (sampleData.is16) {
    //   for (var i = 0; i < sampleCount; ++i) {
    //     bufferData[i] = 0;
    //   }
    // }

    return {
      createSampleSourceNode: createSampleSourceNode,
      getBasePlaybackRate: getBasePlaybackRate,
      getBaseVolume: getBaseVolume,
      getBasePanning: getBasePanning,
      getSampleOffsetInSeconds: getSampleOffsetInSeconds
    };

    function createSampleSourceNode() {
      if (audioBuffer == null) {
        return null;
      }
      var sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      if (loopLength != 0) {
        var duration = audioBuffer.duration;
        sourceNode.loop = true;
        sourceNode.loopStart = (loopStart/sampleCount)*duration;
        sourceNode.loopEnd = ((loopStart + loopLength)/sampleCount)*duration;
      }
      return sourceNode;
    }

    function getBasePlaybackRate() {
      return frequencyFactor;
    }

    function getBaseVolume() {
      return sampleData.volume;
    }

    function getBasePanning() {
      return sampleData.panning;
    }

    function getSampleOffsetInSeconds(sampleOffset) {
      return (sampleOffset/sampleCount)*audioBuffer.duration;
    }
  };

})(window.mp);
