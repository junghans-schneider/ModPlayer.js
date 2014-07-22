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
