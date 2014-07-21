module.exports = function (grunt) {

  grunt.initConfig({

    src: 'src/*.js',

    concat: {
      dev: {
        src: '<%= src %>',
        dest: 'modplayer.js'
      }
    },

    uglify: {
      files: {
        'modplayer.min.js': '<%= src %>'
      }
    },

    watch: {
      js: { files: '<%= src %>', tasks: 'concat' }
    }

  });

  var _ = grunt.util._;

  _.each([
    'contrib-concat',
    'contrib-uglify',
    'contrib-watch',
    'sync-pkg'
  ], loadTasks);

  _.each({
    'default': [ 'concat', 'watch' ],
    'build':   [ 'concat', 'uglify', 'sync' ]
  }, registerTask);

  function loadTasks(name) {
    grunt.loadNpmTasks('grunt-' + name);
  }

  function registerTask(tasks, name) {
    grunt.registerTask(name, [].concat(tasks));
  }

};
