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
