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
