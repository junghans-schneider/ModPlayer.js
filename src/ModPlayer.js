(function (mp) {
  'use strict';

  mp.util.extend(mp.prototype, {

    getPattern: function (index) {
      return this.patterns[this.patternOrder[index]];
    },

    numPatterns: function () {
      return this.patternOrder.length;
    },

    toJSON: function () {
      return mp.util.pick(this, Object.keys(this).filter(isPublic));

      function isPublic(key) {
        return ! mp.util.startsWith(key, '_');
      }
    }

  });

})(window.ModPlayer);
