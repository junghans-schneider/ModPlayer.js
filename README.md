ModPlayer.js
============

JavaScript player for the famous Fasttracker II and Protracker module formats.

Plays modules plugin-free with low CPU usage in modern browsers.

[Demo](http://jsfiddle.net/junghans_schneider/vhBja/embedded/result/)

*Note:* The player is in an early stage of implementation. At the moment there is no API for stopping playback. Also many effects are not implemented, yet.

Requirements
------------

`ModPlayer.js` uses the [HTML5 Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API). See whether your browser is supported at [caniuse.com](http://caniuse.com/#feat=audio-api).

*Note:* The current implementation is known not to play well in Firefox. Please use a Webkit-based browser like Chrome or Safari.

Installation
------------

Download or install with [Bower](http://bower.io/) package manager:

    bower install junghans-schneider/ModPlayer.js

Add a script tag:

    <script src="bower_components/ModPlayer.js/modplayer.min.js"></script>

That's it!

Examples
--------

**Playback**

    mp.module(data).play();

`data` is an [`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/API/ArrayBuffer) in this case. You can also use `mp.loadModule()` to load a module from your server:

    mp.loadModule('mymodule.xm', function (err, module) {
    	if (err) {
    	    // failed to load module
    	} else {
    		module.play();
    	}
    });

**Adding another module format**

There is a simple plugin mechanism for adding support for other module formats. Just register a parser function which returns null for inadequate input:

    mp.format.register(parseMyModule);

    function parseMyModule(data) {
      if (! isMyModule()) {
        return null;
      }

      var iter = mp.format.bytesIter(data);
      var parsedData = readMyModule(iter); // magic happens here

      return parsedData;
    }

The generic `mp.format.parseModule()` function calls each registered parser until one of them doesn't return `null`, i.e. until one of them parsed the data. `data` is an `Int8Array`. We suggest to use the built-in bytes iterator for reading the data:

    iter.str(17); // read next 17 bytes as string
    iter.byte();  // read one byte as integer
    iter.word();  //  ... two bytes
    iter.dword(); //  ... four bytes

    iter.step(2).byte(); // just skip the next 2 bytes, then read a byte
    iter.pos();          // get the current position of the iterator

Numbers are read unsigned and as little endian by default. Pass `true` to read signed:

    iter.word(true);

For words there is also a big endian version:

    iter.word_bigEndian();

Some of the util functions in [`util.js`](https://github.com/junghans-schneider/ModPlayer.js/blob/master/src/util.js) may also help you implementing your format parser.
