(function (win) {
  'use strict';

  if (! Array.from) {
    Array.from = function (arrayLike) {
      return [].slice.call(arrayLike);
    };
  }

  var mp;

  function ModPlayer(buffer) {
    mp.util.extend(this, mp.util.parseMod(new Int8Array(buffer)));
  }

  mp = ModPlayer;

  mp.get = function (url, done) {
    mp.util.get(url, 'arraybuffer', function (err, res) {
      done(err, err ? null : new ModPlayer(res));
    });
  };

  var previous = win.ModPlayer;

  win.ModPlayer = mp;

  ModPlayer.noConflict = function () {
    return (win.ModPlayer = previous, mp);
  };

})(window);
