var command = {
  command: 'test',
  description: 'Run JavaScript and Solidity tests',
  builder: {},
  run: function (options, done) {
    var OS = require("os");
    var path = require("path");
    var dir = require("node-dir");
    var temp = require("temp");
    var Config = require("truffle-config");
    var Artifactor = require("truffle-artifactor");
    var Develop = require("../develop");
    var Test = require("../test");
    var NPMDependencies = require("../npmdeps");
    var fs = require("fs");
    var mkdirp = require("mkdirp");
    var copy = require("../copy");
    var Environment = require("../environment");
    var async = require("async");

    var rootConfig = Config.detect(options);

    // if "development" exists, default to using that for testing
    if (!rootConfig.network && rootConfig.networks.development) {
      rootConfig.network = "development";
    }

    if (!rootConfig.network) {
      rootConfig.network = "test";
    }

    var ipcDisconnect;

    var files = [];

    if (options.file) {
      files = [options.file];
    } else if (options._.length > 0) {
      Array.prototype.push.apply(files, options._);
    }

    function getFiles(callback) {
      if (files.length != 0) {
        return callback(null, files);
      }

      dir.files(rootConfig.test_directory, callback);
    };

    getFiles(function(err, files) {
      if (err) return done(err);

      files = files.filter(function(file) {
        return file.match(rootConfig.test_file_extension_regexp) != null;
      });

      temp.mkdir('test-', function(err, temporaryDirectory) {
        if (err) return done(err);

        function cleanup() {
          var args = arguments;
          // Ensure directory cleanup.
          temp.cleanup(function(err) {
            // Ignore cleanup errors.
            done.apply(null, args);
            if (ipcDisconnect) {
              ipcDisconnect();
            }
          });
        };

        var depConfigs = NPMDependencies.detect(rootConfig, options).map(function(config) {
          var pkgTempDir;

          // HACK: setup temporary directory like node_modules to help the NPM resolver out
          if (config.packageName) {
            pkgTempDir = path.join(temporaryDirectory, "node_modules", config.packageName, "build", "contracts");
          } else {
            pkgTempDir = temporaryDirectory;
          }

          // Set a new artifactor; don't rely on the one created by Environments.
          // TODO: Make the test artifactor configurable.
          config.artifactor = new Artifactor(pkgTempDir);
          if(config === rootConfig)
            return config.with({
              test_files: files,
              pkgTempDir: pkgTempDir,
            });
          else
            return config.with({
              pkgTempDir: pkgTempDir,
            })
        });

        function run() {
          depConfigs.forEach(function(config) {
            config.contracts_build_directory = config.pkgTempDir;
          });

          Test.run(depConfigs, cleanup);
        };

        var environmentCallback = function(err) {
          if (err) return done(err);

          async.eachSeries(depConfigs, function(config, callback) {

            // Copy all the built files over to a temporary directory, because we
            // don't want to save any tests artifacts. Only do this if the build directory
            // exists.
            mkdirp(config.pkgTempDir, function(err) {
              if (err) return callback(err);

              fs.stat(config.contracts_build_directory, function(err, stat) {
                if (err) return callback();

                copy(config.contracts_build_directory, config.pkgTempDir, function(err) {
                  if (err) return callback(err);

                  config.logger.log("Using network '" + config.network + "'." + OS.EOL);

                  callback();
                });
              });
            });
          }, function(err) {
            if (err) return done(err);

            run();
          });
        }

        if (rootConfig.networks[rootConfig.network]) {
          Environment.detect(rootConfig, environmentCallback);
        } else {
          var ipcOptions = {
            network: "test"
          };

          var testrpcOptions = {
            host: "127.0.0.1",
            port: 7545,
            network_id: 4447,
            mnemonic: "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat",
            gasLimit: rootConfig.gas
          };

          Develop.connectOrStart(ipcOptions, testrpcOptions, function(started, disconnect) {
            ipcDisconnect = disconnect;
            Environment.develop(rootConfig, testrpcOptions, environmentCallback);
          });
        }
      });
    });
  }
}

module.exports = command;
