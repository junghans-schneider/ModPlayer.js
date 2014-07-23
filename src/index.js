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
