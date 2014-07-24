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
      patterns:    iter.list(readPattern, header.patterns, header.numChannels),
      instruments: iter.list(readInstrument, header.instruments)
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

    header.patternOrder = iter.list('byte', 256).slice(0, header.patternOrder);
    return header;
  }

  function readPattern(iter, numChannels) {
    var numRows;

    iter.step(5);
    numRows = iter.word();
    iter.step(2);

    return util.flatten(iter.list(readChannel, numRows * numChannels));
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
        sampleMapping:                 iter.list('byte', 96),
        volumeEnvelope:                iter.list('word', 24),
        panningEnvelope:               iter.list('word', 24),
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

      instrument.samples = iter.list(readSample, numSamples).map(addData);
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

    var next = is16 ? 'word' : 'byte', value = 0;

    return iter.list(next, length).map(function (next) {
      value +=  next;
      value &= (is16 ? 0xffff : 0xff);

      if (is16) {
        if (value >= 32768) { value -= 65536; }
      } else {
        if (value >= 128) { value -= 256; }
      }

      return value;
    });
  }

})(window.mp);
