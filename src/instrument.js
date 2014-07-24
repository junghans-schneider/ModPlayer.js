(function (mp) {
  'use strict';

  mp.instrument = function(soundUtil, ticksPerRow, instrumentData) {

    var fadeVolumeStart = 32767;

    var samples = [];

    if (instrumentData.samples) {
      samples = instrumentData.samples.map(mp.sample.bind(null, soundUtil.audioContext));
    }

    var volumeEnvelope = prepareEnvelope(instrumentData, 'volume', 64),
        panningEnvelope = prepareEnvelope(instrumentData, 'panning', 32);

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
      return (fadeVolume/fadeVolumeStart)*(noteVolume/64)*(envelopeVolume/64);
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

    function smoothlySetVolumeAtTime(leftGainNode, rightGainNode, state, volume, panning, time, factor) {
      var volumeLeft = volume*Math.cos(Math.PI/2*panning),
          volumeRight = volume*Math.sin(Math.PI/2*panning);

      state.volumeLeft = smoothlySet(leftGainNode.gain, volumeLeft, state.volumeLeft);
      state.volumeRight = smoothlySet(rightGainNode.gain, volumeRight, state.volumeRight);

      function smoothlySet(gain, volume, oldVolume) {
        if (volume != oldVolume) {
          if (oldVolume == null) {
            gain.value = oldVolume = 0;
          }

          soundUtil.smoothlySetValueAtTime(gain, oldVolume, volume, time, factor);
        }

        return volume;
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
        var envelopePanning = panningEnvelope.points[state.panningEnvelopePos];
        if (envelopePanning == null) {
          envelopePanning = state.envelopePanning;
        }
        if (envelopePanning == null) {
          envelopePanning = 32;
        }
        state.envelopePanning = envelopePanning;
        panning = calculatePanning(effectiveNotePanning, envelopePanning);
        if (state.panningEnvelopePos != panningEnvelope.sustainPos) {
          ++state.panningEnvelopePos;
          if (state.panningEnvelopePos == panningEnvelope.loopEndPos) {
            state.panningEnvelopePos = panningEnvelope.loopEndPos;
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
        var envelopeVolume = volumeEnvelope.points[state.envelopePos];
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
        if (state.keyOff || state.envelopePos != volumeEnvelope.sustainPos) {
          ++state.envelopePos;
          if (state.envelopePos == volumeEnvelope.loopEndPos) {
            state.envelopePos = volumeEnvelope.loopStartPos;
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

    function stopNoteAtTime(volumeState, leftGainNode, rightGainNode, sourceNode, time) {
      soundUtil.smoothlySetValueAtTime(leftGainNode.gain, volumeState.volumeLeft, 0, time);
      soundUtil.smoothlySetValueAtTime(rightGainNode.gain, volumeState.volumeRight, 0, time);

      sourceNode.stop(time + soundUtil.smoothingTime);
    }
  };

  function prepareEnvelope(instrument, envelopeType, startValue) {
    var res = {
      points:       [],
      sustainPos:   -1,
      loopStartPos: -1,
      loopEndPos:   -1
    };

    var type           = get('Type'),
        envelope       = get('Envelope'),
        envelopePoints = get('EnvelopePoints') || 0,
        sustainPoint   = get('EnvelopeSustainPoint'),
        loopStartPoint = get('EnvelopeLoopStartPoint'),
        loopEndPoint   = get('EnvelopeLoopEndPoint');

    if (type&1) {
      var previousPos = -1,
          previousValue = startValue;

      for (var i = 0; i < envelopePoints; ++i) {
        var pos   = envelope[i*2],
            value = envelope[i*2 + 1];

        for (var j = previousPos + 1; j < pos; ++j) {
          res.points[j] = previousValue + (value - previousValue) * (j - previousPos) / (pos - previousPos);
        }

        res.points[pos] = value;

        if (sustainPoint   == i && (type&2)) res.sustainPos = pos;
        if (loopStartPoint == i && (type&4)) res.loopStartPos = pos;
        if (loopEndPoint   == i && (type&4)) res.loopEndPos = pos;

        previousPos = pos;
        previousValue = value;
      }
    }

    return res;

    function get(prop) {
      return instrument[envelopeType + prop];
    }
  }

})(window.mp);
