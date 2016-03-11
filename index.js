/**
 * Git Message Analyzer
 *
 * This script will create a document that contains all commit messages
 * and all descriptions / comments of pull requests
 *
 * @author Jamie Kimmell <jkimmell@fluid.com>
 */

/**
 * Include the necessary modules
 */
var sys = require('sys'),
  exec = require('child_process').exec,
  fs = require('fs'),
  async = require('async'),
  request = require('request'),
  prompt = require('prompt');

/**
 * The location where all messages should be added to
 * @type {String}
 */
var logFile = "./output/output.txt";

/**
 * Headers for the GitHub API requests
 * Authorization will be populated when the "prompts" are entered
 * @type {Object}
 */
var headers = {
  "Authorization": null,
  "User-Agent": "kimmellj-log-file-analyzer"
};

/**
 * Process the repsonses to the prompts for information
 *
 * @param  {Error} err        The error object if there was a problem requesting information
 * @param  {Object} appParms  The answers to the prompts
 * @return {null}
 */
function handleUserPrompts (err, appParms) {
  /**
   * Generate the header for the GitHub Basic Auth
   */
  headers.Authorization = "Basic " + new Buffer(appParms.Username + ":" + appParms.Password).toString("base64");

  /**
   * Run the necessary tasks sequentially
   *
   * 1) Empty the log file and add a header to the file
   * 2) Request and Process the Git Revision List, this will give us all of the commit messags
   * 3) Request all of the Pull Request Information available for this repo
   */
  async.series([
    function(callback) {
      console.log("Emptying log file...");

      emptyFile(logFile, appParms.GHRepoID);
      callback();
    },
    function(callback) {
      console.log("Processing GIT Rev List");

      /**
       * Execute a shell comand to: change into the repo folder, generate the
       * "oneline" list of commit messages and then process the messages
       */
      exec("cd "+appParms.RepoFolder+"; git rev-list --remotes --format='oneline'", function (error, stdout, stderr) {
        processGITRevList(stdout);
        callback();
      });
    },
    function (callback) {
      console.log("Processing Pull Request List");

      loadPullRequestPage("https://api.github.com/repos/"+appParms.GHRepoID+"/pulls?state=all", callback);
    }
  ]);
}

/**
 * Truncate the output file and add a header with the date
 *
 * @param  {String} logFile The location of where output should be saved
 * @return {null}
 */
function emptyFile(logFile, repoID) {
  var writeStream = fs.createWriteStream(logFile);

  writeStream.write(
    "====================================== \n" +
    repoID + " GIT History - "+new Date().toISOString()+"\n" +
    "====================================== \n"
  );

  writeStream.close();
}

/**
 * Process the output of the shell command that generated the Git Revision List
 * by writing the Buffer out to the output file
 *
 * @param  {Buffer} stdout The Standard Output Buffer from executing the command
 */
function processGITRevList(stdout) {
  var writeStream = fs.createWriteStream(logFile, {flags: "a"});
  writeStream.write(stdout.toString());
  writeStream.close();
}

/**
 * Load a page of pull requests with the given URL and the execute the callback
 * when finished. This will also review the "link" header to see if there are more
 * pages to retrieved. If there are, we recursively call this function until there
 * are no more pages to retieve.
 *
 * @param  {String}   url      The GitHub API URL to a paged list of pull requests
 * @param  {Function} callback [description]
 * @return {[type]}            [description]
 */
function loadPullRequestPage(url, callback) {
  console.log("Working on: "+url);

  /**
   * Open a write stream to the output file
   */
  var writeStream = fs.createWriteStream(logFile, {flags: "a"});

  /**
   * Make the HTTPS request to the give API url,  using the shared headers that
   * were populated initially
   */
  request(
      {
          url : url,
          headers: headers
      },
      function (error, response, body) {
        /**
         * Retrieve the "next" page link by processing the "link" header
         * @type {[type]}
         */
        var links = response.headers.link;

        var regex = new RegExp(/\<(.*?)\>\; rel\=\"next\"/g);
        var matches = regex.exec(links);
        var nextURL = matches && matches.length > 0 ? matches[1] : false;

        /**
         * Get a list of pull requests by parsing the JSON response
         */
        var pullRequests = JSON.parse(body);

        /**
         * Loop across each pull request sequentially. We do it this way so that
         * we don't make too many network request too fast and the details about
         * a pull request a kept together in the output
         */
        async.eachSeries(pullRequests, function iterator(pullRequest, prCallback){
          console.log("Pull Request: "+pullRequest.number);

          /**
           * Write the title + description of the  pull request out to file
           */
          writeStream.write("PR: "+pullRequest.number+"| Title + Body: "+pullRequest.title+" "+pullRequest.body.replace(new RegExp(/\r?\n|\r/g), " <nl> ")+"\n");

          /**
           * Request all of the comments for this pull request and then process
           * each one
           */
          request({
            url : pullRequest.comments_url,
            headers: headers
          }, function (error, response, body){

            /**
             * Get a list of comments by parsing the JSON response
             */
            var comments = JSON.parse(body);

            /**
             * Write the number of comments available for this pull request
             */
            writeStream.write("PR: "+pullRequest.number+"| Comments ("+comments.length+"): "+"\n");

            /**
             * Loop across all of the comments and then add them to the output file
             * replacing any new lines with <nl>. We do this replace so that our
             * output file is nice and neat.
             */
            async.eachSeries(comments, function iterator(comment, commentCallback){
              writeStream.write("\t PR: "+pullRequest.number+"| Comment: "+comment.body.replace(new RegExp(/\r?\n|\r/g), " <nl> ")+"\n");
              commentCallback();
            }, function(){
              prCallback();
            });
          });
        }, function(){
          /**
           * Close the write stream
           */
          writeStream.close();

          /**
           * If we have a next page to process, process it
           */
          if (nextURL) {
            loadPullRequestPage(nextURL, callback);
          } else {
            callback();
          }
        });
      }
  );
}

/**
 * Start the Prompt plugin
 * @return null
 */
prompt.start();

/**
 * Request parameters for this script from the user executing the script
 *
 * @todo Instead of requiring users to enter a path to the repo, we should just clone a fresh copy
 *
 * @param  {String} ['Username'       GitHub Username
 * @param  {String} 'Password'        GitHub Password
 * @param  {String} 'GHRepoID'        GitHub Repository ID - User/Repo - kimmellj/git-message-analyzer
 * @param  {String} 'RepoFolder']     The local file location of a cloned copy of the GitHub Repo
 * @param  {function} handleUserPrompts Function to process the responses to the prompts
 * @return null
 */
prompt.get(['Username', 'Password', 'GHRepoID', 'RepoFolder'], handleUserPrompts);
