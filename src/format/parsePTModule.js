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
      instruments: iter.list(readInstrument, 31),
      speed:       125,
      tempo:       6
    };

    var patternOrderLength = iter.byte(),
        patternOrder = iter.step(1).list('byte', 128),
        numPatterns = Math.max.apply(null, patternOrder) + 1;

    module.patternOrder = patternOrder.slice(0, patternOrderLength);
    module.id           = iter.str(4);
    module.numChannels  = numChannels(module.id);
    module.patterns     = iter.list(readPattern, numPatterns, module.numChannels);

    module.instruments.forEach(addSampleData);
    return module;

    function addSampleData(instrument) {
      var sample = instrument.samples && instrument.samples[0];

      if (sample) {
        sample.data = readSampleData(iter, sample.length);
      }
    }
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
      length:     bigEndianWord(iter) * 2,
      finetune:   modfinetunes[iter.byte() & 15],
      volume:     iter.byte(),
      loopStart:  bigEndianWord(iter) * 2,
      loopLength: bigEndianWord(iter) * 2,
      panning:    128,
      relnote:    0
    };

    sample.loopType = sample.loopEnd > 2 ? 'forward' : null;
    return sample;
  }

  function readSampleData(iter, length) {
    return iter.list('byte', length).map(function (value) {
      return (value < 128) ? value : (value - 256);
    });
  }

  function numChannels(id) {
    return ({ 'M.K.': 4, 'M!K!': 4, 'FLT4': 4, 'FLT8': 8, 'OKTA': 8, 'OCTA': 8, 'FA08': 8, 'CD81': 8 })[id] || parseInt(/(\d+)CH/.exec(id)[1], 10);
  }

  function readPattern(iter, numChannels) {
    return mp.util.flatten(iter.list(readChannel, 64 * numChannels)); // 64 rows
  }

  function readChannel(iter) {
    var b1 = iter.byte(),
        b2 = iter.byte(),
        b3 = iter.byte(),
        b4 = iter.byte();

    var note =((b1&0xf)<<8)+b2,
        ins  = (b1&0xf0)+(b3>>4),
        fx   =  b3&0xf;

    note = amigaPeriodToNote(note);

    if (! b4) {
      if (fx == 0x1) fx = 0;
      if (fx == 0x2) fx = 0;
      if (fx == 0xA) fx = 0;
      if (fx == 0x5) fx = 0x3;
      if (fx == 0x6) fx = 0x4;
    }

    return [ note, ins, 0, fx, b4 ];
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

  function bigEndianWord(iter) {
    return ((iter.byte() << 8) + iter.byte());
  }

})(window.mp);
