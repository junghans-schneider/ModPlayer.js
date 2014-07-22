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
