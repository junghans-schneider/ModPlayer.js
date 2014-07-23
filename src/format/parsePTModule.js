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
      title: iter.str(20).trim(),
      speed: 125,
      tempo: 6
    };

    module.instruments = list(readInstrument, 31, iter);

    var numOrders = iter.byte();

    iter.step(1);

    var patterns = mp.util.range(128).map(iter.byte);

    module.patternOrder = patterns.slice(0, numOrders);
    module.id = iter.str(4);
    module.numChannels = numChannels(module.id);

    var numPatterns = Math.max.apply(null, patterns) + 1;

    module.patterns = mp.util.range(numPatterns).map(function () {
      return mp.util.flatten(list(readChannel, 64 * module.numChannels, iter)); // 64 rows
    });

    module.instruments.forEach(function (instrument) {
      if (instrument.samples) {
        var sample = instrument.samples[0];
        sample.data = mp.util.range(sample.sampLen).map(function () {
          return iter.byte() ^ 0xff;
        });
      }
    });

    return module;
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

  var modfinetunes = [ 0, 16, 32, 48, 64, 80, 96, 112, -128, -112, -96, -80, -64, -48, -32, -16 ];

  function readSample(iter) {
    var sample = {
      sampLen:    iter.word_bigEndian() * 2,
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

  function numChannels(id) {
    return ({ 'M.K.': 4, 'M!K!': 4, 'FLT4': 4, 'FLT8': 8, 'OKTA': 8, 'OCTA': 8, 'FA08': 8, 'CD81': 8 })[id] || parseInt(/(\d+)CH/.exec(id)[1], 10);
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
