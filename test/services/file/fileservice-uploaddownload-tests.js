// 
// Copyright (c) Microsoft and contributors.  All rights reserved.
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//   http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// 
// See the License for the specific language governing permissions and
// limitations under the License.
// 
var assert = require('assert');
var fs = require('fs');
var util = require('util');
var crypto = require('crypto');
var path = require('path');

// Lib includes
var testutil = require('../../framework/util');
var SR = require('../../../lib/common/util/sr');
var azureutil = require('../../../lib/common/util/util');
var TestSuite = require('../../framework/test-suite');

if (testutil.isBrowser()) {
  var azure = AzureStorage.File;
} else {
  var azure = require('../../../');
}
var rfs = require('../../../lib/common/streams/readablefs');

var Constants = azure.Constants;
var HttpConstants = Constants.HttpConstants;
var HeaderConstants = Constants.HeaderConstants;

var shareNamesPrefix = 'upload-test-share-';
var directoryNamesPrefix = 'dir-';
var fileNamesPrefix = 'file-';

var localFileName = 'fileservice_test_block.tmp';
var localLargeFileName = 'fileservice_test_large.tmp';
var notExistFileName = 'fileservice_not_exist.tmp';
var zeroSizeFileName = 'fileservice_zero_size_file.tmp';
var downloadFileName = 'fileservice_download.tmp';

var fileService;
var shareName;
var directoryName;
var fileName;

var suite = new TestSuite('fileservice-uploaddownload-tests');
var runOrSkip = testutil.itSkipMock(suite.isMocked);
var skipBrowser = testutil.itSkipBrowser();
var skipMockAndBrowser = testutil.itSkipMockAndBrowser(suite.isMocked);

function writeFile(fileName, content) {
  fs.writeFileSync(fileName, content);
  var md5hash = crypto.createHash('md5');
  md5hash.update(content);
  return md5hash.digest('base64');
}

function generateTempFile(fileName, size, hasEmptyBlock, callback) {
  var blockSize = 4 * 1024 * 1024;
  var fileInfo = { name: fileName, contentMD5: '', size: size };

  if (fs.existsSync(fileName)) {
    var status = fs.statSync(fileName);
    if (status.size == size) {
      callback(fileInfo);
      return;
    }
  }   

  var md5hash = crypto.createHash('md5');
  var offset = 0;
  var file = fs.openSync(fileName, 'w');
  do {
    var value = crypto.randomBytes(1);
    var zero = hasEmptyBlock ? (parseInt(value[0], 10) >= 64) : false;
    var writeSize = Math.min(blockSize, size);
    var buffer;

    if (zero) {
      buffer = Buffer.alloc(writeSize);
      buffer.fill(0);
    } else {
      buffer = crypto.randomBytes(writeSize);
    }
      
    fs.writeSync(file, buffer, 0, buffer.length, offset);
    size -= buffer.length;
    offset += buffer.length;
    md5hash.update(buffer);
  } while(size > 0);
      
  fileInfo.contentMD5 = md5hash.digest('base64');
  callback(fileInfo);
};

describe('FileUploadDownload', function () {
  before(function (done) {
    if (suite.isMocked) {
      testutil.POLL_REQUEST_INTERVAL = 0;
    }
    suite.setupSuite(function () {
      fileService = azure.createFileService(process.env['AZURE_STORAGE_CONNECTION_STRING']).withFilter(new azure.ExponentialRetryPolicyFilter());
      done();
    });     
  });

  after(function (done) {
    try { fs.unlinkSync(localFileName); } catch (e) {}
    try { fs.unlinkSync(notExistFileName); } catch (e) {}
    try { fs.unlinkSync(zeroSizeFileName); } catch (e) {}
    try { fs.unlinkSync(downloadFileName); } catch (e) {}
    try { fs.unlinkSync(localLargeFileName); } catch (e) {}
    suite.teardownSuite(done);
  });

  beforeEach(function (done) {
    fileName = suite.getName(fileNamesPrefix);
    suite.setupTest(done);
  });

  afterEach(function (done) {
    suite.teardownTest(done);
  });

  describe('prepare file upload-download test', function () {
    it('should create the test share', function (done) {
      shareName = suite.getName(shareNamesPrefix);
      fileService.createShareIfNotExists(shareName, function (createError) {
        assert.equal(createError, null);
        directoryName = suite.getName(directoryNamesPrefix);
        fileService.createDirectoryIfNotExists(shareName, directoryName, function (createError) {
        assert.equal(createError, null);
          done();
        });
      });
    });
  });

  describe('createWriteStream', function() {
    skipMockAndBrowser('existing file', function (done) {
      var fileBuffer = Buffer.alloc( 5 * 1024 * 1024 );
      fileBuffer.fill(1);

      // Write file so that it can be piped
      fs.writeFile(localFileName, fileBuffer, function() {
        fileService.createFile(shareName, directoryName, fileName, 5 * 1024 * 1024, function (err) {
          assert.equal(err, null);
          // Pipe file to a file
          var stream = fileService.createWriteStreamToExistingFile(shareName, directoryName, fileName);
          var readable = rfs.createReadStream(localFileName);
          readable.pipe(stream);
          stream.on('close', function () {
            fileService.getFileToText(shareName, directoryName, fileName, function (err, text) {
              assert.equal(err, null);
              assert.equal(text, fileBuffer);
              done();
            });
          });
        });
      });
    });

    skipMockAndBrowser('new file', function (done) {
      var fileBuffer = Buffer.alloc( 6 * 1024 * 1024 );
      fileBuffer.fill(1);

      // Write file so that it can be piped
      fs.writeFile(localFileName, fileBuffer, function() {
        // Pipe file to a file
        var stream = fileService.createWriteStreamToNewFile(shareName, directoryName, fileName, 6 * 1024 * 1024);
        var readable = rfs.createReadStream(localFileName);
        readable.pipe(stream);
        stream.on('close', function () {
          fileService.getFileToText(shareName, directoryName, fileName, function (err, text) {
            assert.equal(err, null);
            assert.equal(text, fileBuffer);
            done();
          });
        });
      });
    });

    skipMockAndBrowser('store the MD5 on the server', function (done) {
      var fileBuffer = Buffer.alloc( 3 * 1024 * 1024 );
      fileBuffer.fill(1);

      // Write file so that it can be piped
      fileContentMD5 = writeFile(localFileName, fileBuffer);

      fileService.createFile(shareName, directoryName, fileName, 3 * 1024 * 1024, function (err) {
        assert.equal(err, null);
        // Pipe file to a file
        var stream = fileService.createWriteStreamToExistingFile(shareName, directoryName, fileName, {storeFileContentMD5: true});
        var readable = rfs.createReadStream(localFileName);
        readable.pipe(stream);
        stream.on('close', function () {
          fileService.getFileProperties(shareName, directoryName, fileName, function (err, file) {
            assert.equal(err, null);
            assert.equal(file.contentSettings.contentMD5, fileContentMD5);
            done();
          });
        });
      });
    });

    skipBrowser('should emit error events', function (done) {
      var fileText = "Hello, world!"
      writeFile(localFileName, fileText);

      var stream = fileService.createWriteStreamToExistingFile(shareName, directoryName, fileName);
      stream.on('error', function (error) {
        assert.equal(error.code, 'ResourceNotFound');
        assert.equal(error.statusCode, '404');
        assert.notEqual(error.requestId, null);
        done();
      });

      rfs.createReadStream(localFileName).pipe(stream);
    });
  });

  describe('createReadStream', function() {
    skipMockAndBrowser('download file', function (done) {
      var sourceFileNameTarget = testutil.generateId('getFileSourceFile', [], suite.isMocked) + '.test';
      var destinationFileNameTarget = testutil.generateId('getFileDestinationFile', [], suite.isMocked) + '.test';

      var fileBuffer = Buffer.alloc( 5 * 1024 );
      fileBuffer.fill(1);

      fs.writeFileSync(sourceFileNameTarget, fileBuffer);

      fileService.createFileFromStream(shareName, directoryName, fileName, rfs.createReadStream(sourceFileNameTarget), 5 * 1024, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);

        var writable = fs.createWriteStream(destinationFileNameTarget);
        fileService.createReadStream(shareName, directoryName, fileName).pipe(writable);

        writable.on('close', function () {
          var exists = fs.existsSync(destinationFileNameTarget);
          assert.equal(exists, true);

          fs.readFile(destinationFileNameTarget, function (err, destFileText) {
            fs.readFile(sourceFileNameTarget, function (err, srcFileText) {
              assert.deepEqual(destFileText, srcFileText);

              try { fs.unlinkSync(sourceFileNameTarget); } catch (e) {}
              try { fs.unlinkSync(destinationFileNameTarget); } catch (e) {}

              done();
            });
          });
        });
      });
    });
    
    skipBrowser('should emit error events', function (done) {
      var stream = fileService.createReadStream(shareName, directoryName, fileName);
      stream.on('error', function (error) {
        assert.equal(error.code, 'NotFound');
        assert.equal(error.statusCode, '404');
        assert.notEqual(error.requestId, null);

        done();
      });

      stream.pipe(fs.createWriteStream(downloadFileName));
    });
  });

  describe('getFileRange', function() {
    it('getFileRange', function (done) {
      var data1 = 'Hello, World!';

      // Create the empty file
      fileService.createFileFromText(shareName, directoryName, fileName, data1, function (err) {
        assert.equal(err, null);

        fileService.getFileToText(shareName, directoryName, fileName, { rangeStart: 2, rangeEnd: 3 }, function (err3, content1) {
          assert.equal(err3, null);

          // get the double ll's in the hello
          assert.equal(content1, 'll');

          done();
        });
      });
    });

    it('getFileRangeOpenEnded', function (done) {
      var data1 = 'Hello, World!';

      // Create the empty file
      fileService.createFileFromText(shareName, directoryName, fileName, data1, function (err) {
        assert.equal(err, null);

        fileService.getFileToText(shareName, directoryName, fileName, { rangeStart: 2 }, function (err3, content1) {
          assert.equal(err3, null);

          // get the last bytes from the message
          assert.equal(content1, 'llo, World!');

          done();
        });
      });
    });
  });

  describe('createRangesFromStream', function() {
    skipBrowser('should work', function (done) {
      var fileText = "createRangesFromStreamText";
      var fileMD5 = writeFile(localFileName, fileText);

       fileService.createFile(shareName, directoryName, fileName, fileText.length + 5, function (err) {
        assert.equal(err, null);

        var stream = rfs.createReadStream(localFileName);
        fileService.createRangesFromStream(shareName, directoryName, fileName, stream, 5, 5 + fileText.length - 1, function(err2) {
          assert.equal(err2, null);

           fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
            assert.equal(downloadErr, null);
            assert.ok(downloadResponse.isSuccessful);
            assert.ok(file);
            assert.equal(text, '\u0000\u0000\u0000\u0000\u0000' + fileText);

            done();       
          });
        });
       });
    });

    skipBrowser('should work with transactional MD5', function (done) {
      var fileText = "createRangesFromStreamText";
      var fileMD5 = writeFile(localFileName, fileText);

       fileService.createFile(shareName, directoryName, fileName, fileText.length, function (err) {
        assert.equal(err, null);

        var callback = function (webresource) {
          assert.notEqual(webresource.headers[HeaderConstants.CONTENT_MD5], null);
        };

        fileService.on('sendingRequestEvent', callback);
        fileService.createRangesFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), 0, fileText.length - 1, {useTransactionalMD5: true}, function(err2) {
          // Upload all data
          assert.equal(err2, null);
          fileService.removeAllListeners('sendingRequestEvent');   

           fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
            assert.equal(downloadErr, null);
            assert.ok(downloadResponse.isSuccessful);
            assert.ok(file);
            assert.equal(text, fileText);

            done();
          });           
        });
      });
    });

    skipBrowser('should work with MD5', function (done) {
      var fileText = "createRangesFromStreamText";
      var fileMD5 = writeFile(localFileName, fileText);
      
       fileService.createFile(shareName, directoryName, fileName, fileText.length, function (err) {
        assert.equal(err, null);

        var callback = function (webresource) {
          assert.notEqual(webresource.headers[HeaderConstants.CONTENT_MD5], null);
        };

        fileService.on('sendingRequestEvent', callback);
        fileService.createRangesFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), 0, fileText.length - 1, {transactionalContentMD5: fileMD5}, function(err2) {
          // Upload all data
          assert.equal(err2, null);
          fileService.removeAllListeners('sendingRequestEvent');

           fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
            assert.equal(downloadErr, null);
            assert.ok(downloadResponse.isSuccessful);
            assert.ok(file);
            assert.equal(text, fileText);

            done();
          });
        });
      });
    });
  });

  describe('clearRange', function() {
    skipBrowser('should work', function (done) {
      var buffer = Buffer.alloc(512);
      buffer.fill(0);
      buffer[0] = '1';
      writeFile(localFileName, buffer);

        fileService.createFile(shareName, directoryName, fileName, 1024 * 1024 * 1024, function (err) {
        assert.equal(err, null);

        fileService.createRangesFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), 512, 512 + buffer.length - 1, function(err2) {
          assert.equal(err2, null);

          fileService.clearRange(shareName, directoryName, fileName, 512, 512 + buffer.length - 1, function (err) {
            assert.equal(err, null);

            fileService.listRanges(shareName, directoryName, fileName, function (error, ranges) {
              assert.equal(error, null);
              assert.notEqual(ranges, null);
              assert.equal(ranges.length, 0);

              done();
            });
          });
        });
      });
    });

    skipBrowser('multiple ranges', function (done) {
      var buffer = Buffer.alloc(1024);
      buffer.fill(0);
      buffer[0] = '1';
      writeFile(localFileName, buffer);

       fileService.createFile(shareName, directoryName, fileName, 1024 * 1024 * 1024, function (err) {
        assert.equal(err, null);

        fileService.createRangesFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), 0, buffer.length - 1, function(err2) {
          assert.equal(err2, null);

          fileService.clearRange(shareName, directoryName, fileName, 512, 1023, function (err) {
            assert.equal(err, null);

            fileService.listRanges(shareName, directoryName, fileName, function (error, ranges) {
              assert.equal(error, null);
              assert.notEqual(ranges, null);
              assert.equal(ranges.length, 1);
              assert.equal(ranges[0].start, 0);
              assert.equal(ranges[0].end, 511);

              done();
            });
          });
        });
      });
    });
  });

  describe('listRanges', function() {
    skipBrowser('should work', function (done) {
      var buffer = Buffer.alloc(512);
      buffer.fill(0);
      buffer[0] = '1';
      writeFile(localFileName, buffer);

       fileService.createFile(shareName, directoryName, fileName, 1024 * 1024 * 1024, function (err) {
        assert.equal(err, null);

        fileService.createRangesFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), 0, buffer.length - 1, function(err2) {
          assert.equal(err2, null);

          // Only one range present
          fileService.listRanges(shareName, directoryName, fileName, function (error, ranges) {
            assert.equal(error, null);
            assert.notEqual(ranges, null);
            assert.equal(ranges.length, 1);
            assert.equal(ranges[0].start, 0);
            assert.equal(ranges[0].end, buffer.length - 1);

            done();
          });
        });
      });
    });

    it('empty file', function (done) {
       fileService.createFile(shareName, directoryName, fileName, 1024 * 1024 * 1024, function (err) {
        assert.equal(err, null);

        // Only one range present
        fileService.listRanges(shareName, directoryName, fileName, function (error, ranges) {
          assert.equal(error, null);
          assert.notEqual(ranges, null);
          assert.equal(ranges.length, 0);

          done();
        });
      });
    });

    skipBrowser('multiple discrete ranges', function (done) {
      var buffer = Buffer.alloc(512);
      buffer.fill(0);
      buffer[0] = '1';
      writeFile(localFileName, buffer);

      fileService.createFile(shareName, directoryName, fileName, 1024 * 1024 * 1024, function (err) {
        assert.equal(err, null);

        fileService.createRangesFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), 0, buffer.length - 1, function (err2) {
          assert.equal(err2, null);

          fileService.createRangesFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), 1048576, 1048576 + buffer.length - 1, function (err3) {
            assert.equal(err3, null);

            // Get ranges
            fileService.listRanges(shareName, directoryName, fileName, function (error5, ranges) {
              assert.equal(error5, null);
              assert.notEqual(ranges, null);
              assert.equal(ranges.length, 2);
              assert.equal(ranges[0].start, 0);
              assert.equal(ranges[0].end, buffer.length - 1);
              assert.equal(ranges[1].start, 1048576);
              assert.equal(ranges[1].end, 1048576 + buffer.length - 1);

              done();
            });
          });
        });
      });
    });
  });

  describe('getFileToLocalFile', function() {
    var fileText = "Hello world!";

    skipBrowser('should work with basic file', function(done) {
      writeFile(localFileName, fileText);
      fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, function (err) {
        assert.equal(err, null);
        fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, function (err, file) {
          assert.equal(err, null);
          assert.ok(file);
          assert.equal(file.share, shareName);
          assert.equal(file.directory, directoryName);
          assert.equal(file.name, fileName);

          var exists = fs.existsSync(downloadFileName);
          assert.equal(exists, true);

          fs.readFile(downloadFileName, function (err, text) {
            assert.equal(text, fileText);
            done();
          });
        });
      });
    });
    
    skipBrowser('should skip the size check', function(done) {
      writeFile(localFileName, fileText);
      fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, function (err) {
        assert.equal(err, null);
        var elapsed1 = new Date().valueOf();
        fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, function (err, file) {
          elapsed1 = new Date().valueOf() - elapsed1;
          assert.equal(err, null);
          assert.ok(file);
          assert.equal(file.share, shareName);
          assert.equal(file.directory, directoryName);
          assert.equal(file.name, fileName);

          var exists = fs.existsSync(downloadFileName);
          assert.equal(exists, true);

          fs.readFile(downloadFileName, function (err, text) {
            assert.equal(text, fileText);
            
            var elapsed2 = new Date().valueOf();
            var options = { skipSizeCheck: true };
            fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, options, function (err, file) {
              elapsed2 = new Date().valueOf() - elapsed2;
              assert.ok(suite.isMocked ? true : elapsed1 > elapsed2);
              assert.equal(err, null);
              assert.ok(file);
              assert.equal(file.share, shareName);
              assert.equal(file.directory, directoryName);
              assert.equal(file.name, fileName);
    
              var exists = fs.existsSync(downloadFileName);
              assert.equal(exists, true);
    
              fs.readFile(downloadFileName, function (err, text) {
                assert.equal(text, fileText);
                done();
              });
            });
          });
        });
      });
    });

    skipMockAndBrowser('should work with file range', function(done) {
      var size = 99*1024*1024; // Do not use a multiple of 4MB size
      var rangeStart = 100;
      var rangeEnd = size - 200;
      generateTempFile(localLargeFileName, size, false, function (fileInfo) {
        var uploadOptions = {storeFileContentMD5: true, parallelOperationThreadCount: 5};
        fileService.createFileFromLocalFile(shareName, directoryName, fileName, localLargeFileName, uploadOptions, function (err) {
          assert.equal(err, null);
          var downloadOptions = {useTransactionalMD5: true, parallelOperationThreadCount: 5, rangeStart: 100, rangeEnd: size - 200};
          fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, downloadOptions, function (err, file) {
            assert.equal(err, null);
            assert.ok(file);

            var status = fs.statSync(downloadFileName);
            assert.equal(status.size, rangeEnd - rangeStart + 1);
            done();
          });
        });
      });
    });

    skipMockAndBrowser('should return speedSummary correctly', function(done) {
      var size = 99*1024*1024; // Do not use a multiple of 4MB size
      generateTempFile(localLargeFileName, size, false, function (fileInfo) {
        var uploadOptions = {
          storeFileContentMD5: true,
          parallelOperationThreadCount: 5
        };
          
        fileService.createFileFromLocalFile(shareName, directoryName, fileName, localLargeFileName, uploadOptions, function (err) {
          assert.equal(err, null);
          
          var speedSummary;
          var downloadOptions = {
            useTransactionalMD5: true, 
            parallelOperationThreadCount: 5
          };
          
          speedSummary = fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, downloadOptions, function (err, file) {
            assert.equal(err, null);
            
            assert.equal(speedSummary.getTotalSize(false), size);
            assert.equal(speedSummary.getCompleteSize(false), size);
            assert.equal(speedSummary.getCompletePercent(), '100.0');
            
            done();
          });
          
          assert.notEqual(speedSummary, null);
        });
      });
    });

    skipBrowser('should calculate content md5', function(done) {
      fileContentMD5 = writeFile(localFileName, fileText);
      fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, {storeFileContentMD5: true}, function (err) {
        assert.equal(err, null);        
        var options = {disableContentMD5Validation : false};
        fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, options, function (err, file) {
          assert.equal(err, null);
          assert.equal(file.contentSettings.contentMD5, fileContentMD5);

          var exists = fs.existsSync(downloadFileName);
          assert.equal(exists, true);

          fs.readFile(downloadFileName, function (err, text) {
            assert.equal(text, fileText);
            done();
          });
        });
      });
    });
    
    skipBrowser('should download a file to a local file in chunks', function (done) {
      var buffer = Buffer.alloc(4 * 1024 * 1024 + 512); // Don't be a multiple of 4MB to cover more scenarios
      var originLimit = fileService.singleFileThresholdInBytes;
      buffer.fill(0);
      writeFile(localFileName, buffer);
      fileService.singleFileThresholdInBytes = 1024 * 1024;
      fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, function (error) {
        assert.equal(error, null);
        
        var downloadOptions = { parallelOperationThreadCount : 2 };
        fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, downloadOptions, function (err, file) {
          assert.equal(error, null);
          fileService.singleFileThresholdInBytes = originLimit;
          done();
        });
      });
    });
  });

  describe('getFileToStream', function() {
    var fileText = "Hello world!";

    skipBrowser('should work with basic stream', function (done) {
      fileContentMD5 = writeFile(localFileName, fileText);
      var stream = rfs.createReadStream(localFileName);
      fileService.createFileFromStream(shareName, directoryName, fileName, stream, fileText.length, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);

        fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), function (downloadErr, file, downloadResponse) {
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(file.share, shareName);
          assert.equal(file.directory, directoryName);
          assert.equal(file.name, fileName);

          var exists = fs.existsSync(downloadFileName);
          assert.equal(exists, true);

          fs.readFile(downloadFileName, function (err, text) {
            assert.equal(text, fileText);
            done();
          });
        });
      });
    });
    
    skipBrowser('should skip the size check', function (done) {
      fileContentMD5 = writeFile(localFileName, fileText);
      var stream = rfs.createReadStream(localFileName);
      fileService.createFileFromStream(shareName, directoryName, fileName, stream, fileText.length, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);
        
        var elapsed1 = new Date().valueOf();
        fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), function (downloadErr, file, downloadResponse) {
          elapsed1 = new Date().valueOf() - elapsed1;
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(file.share, shareName);
          assert.equal(file.directory, directoryName);
          assert.equal(file.name, fileName);

          var exists = fs.existsSync(downloadFileName);
          assert.equal(exists, true);

          fs.readFile(downloadFileName, function (err, text) {
            assert.equal(text, fileText);
            var elapsed2 = new Date().valueOf();
            var options = { skipSizeCheck: true };
            fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), options, function (downloadErr, file, downloadResponse) {
              elapsed2 = new Date().valueOf() - elapsed2;
              assert.ok(suite.isMocked ? true : elapsed1 > elapsed2);
              assert.equal(downloadErr, null);
              assert.ok(downloadResponse.isSuccessful);
              assert.ok(file);
              assert.equal(file.share, shareName);
              assert.equal(file.directory, directoryName);
              assert.equal(file.name, fileName);
    
              var exists = fs.existsSync(downloadFileName);
              assert.equal(exists, true);
    
              fs.readFile(downloadFileName, function (err, text) {
                assert.equal(text, fileText);
                done();
              });
            });
          });
        });
      });
    });

    skipMockAndBrowser('should NOT write error message to destination stream', function (done) {
      var downloadFileName = testutil.generateId('getFileToStream', [], suite.isMocked) + '.test';
      try { fs.unlinkSync(downloadFileName); } catch (e) {}
      fileService.getFileToStream(shareName, '', fileName, fs.createWriteStream(downloadFileName), {skipSizeCheck: true}, function (downloadErr, file, downloadResponse) {
        var content = fs.readFileSync(downloadFileName);
        assert.equal(content.length, 0);
        try { fs.unlinkSync(downloadFileName); } catch (e) {}
        done();
      });
    });

    skipMockAndBrowser('should work with range', function (done) {
      var size = 99*1024*1024; // Do not use a multiple of 4MB size
      var rangeStart = 100;
      var rangeEnd = size - 200;
      generateTempFile(localLargeFileName, size, false, function (fileInfo) {
        var stream = rfs.createReadStream(localLargeFileName);
        var uploadOptions = {storeFileContentMD5: true, parallelOperationThreadCount: 5};
        fileService.createFileFromStream(shareName, directoryName, fileName, stream, size, uploadOptions, function (uploadError, file, uploadResponse) {
          assert.equal(uploadError, null);
          assert.ok(file);
          assert.ok(uploadResponse.isSuccessful);

          var downloadOptions = {useTransactionalMD5: true, parallelOperationThreadCount: 5, rangeStart: 100, rangeEnd: size - 200};
          fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), downloadOptions, function (downloadErr, file, downloadResponse) {
            assert.equal(downloadErr, null);
            assert.notEqual(file.contentSettings.contentMD5, null);

            assert.ok(downloadResponse.isSuccessful);
            assert.ok(file);

            var exists = fs.existsSync(downloadFileName);
            assert.equal(exists, true);

            var status = fs.statSync(downloadFileName);
            assert.equal(status.size, rangeEnd - rangeStart + 1);
            done();
          });
        });
      });
    });

    skipBrowser('should calculate content md5', function(done) {
      fileContentMD5 = writeFile(localFileName, fileText);
      var stream = rfs.createReadStream(localFileName);
      fileService.createFileFromStream(shareName, directoryName, fileName, stream, fileText.length, {storeFileContentMD5: true}, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);

        var options = {disableContentMD5Validation : false};
        fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), options, function(downloadErr, file, downloadResponse) {
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(file.contentSettings.contentMD5, fileContentMD5);

          var exists = fs.existsSync(downloadFileName);
          assert.equal(exists, true);

          fs.readFile(downloadFileName, function (err, text) {
            assert.equal(text, fileText);
            done();
          });
        });
      });
    });
  });

  describe('createFileFromText', function () {
    it('should work with empty text', function(done){
      var fileText = '';
      var fileName='emptyfile';
      fileService.createFileFromText(shareName, directoryName, fileName, fileText, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);
        assert.equal(file.share, shareName);
        assert.equal(file.directory, directoryName);
        assert.equal(file.name, fileName);

        fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(text, fileText);

          done();
        });
      });
    });

    it('should work with basic text', function (done) {
      var fileText = 'Hello World';
      fileService.createFileFromText(shareName, directoryName, fileName, fileText, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);
        assert.equal(file.share, shareName);
        assert.equal(file.directory, directoryName);
        assert.equal(file.name, fileName);

        fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(text, fileText);

          done();
        });
      });
    });

    it('should work with strange chars(ASCII)', function (done) {
      fileName = 'def@#abefdef& &abcde+=-';

      var fileText = 'def@#/abef?def/& &/abcde+=-';
      fileService.createFileFromText(shareName, directoryName, fileName, fileText, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);

        fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(text, fileText);

          done();
        });
      });
    });

    it('should work with stange chars(GB18030)', function (done) {
      fileName = '\u2488\u2460\u216B\u3128\u3129'.toString('GB18030');

      var fileText = '\u2488\u2460\u216B\u3128\u3129'.toString('GB18030');
      fileService.createFileFromText(shareName, directoryName, fileName, fileText, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);

        fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(text, fileText);

          done();
        });
      });
    });

    it('should work with buffer', function (done) {
      var fileText = Buffer.from('Hello World');
      fileService.createFileFromText(shareName, directoryName, fileName, fileText, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.ok(file);
        assert.ok(uploadResponse.isSuccessful);

        fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, text, file, downloadResponse) {
          assert.equal(downloadErr, null);
          assert.ok(downloadResponse.isSuccessful);
          assert.ok(file);
          assert.equal(text, fileText);

          done();
        });
      });
    });

    it('should work with storeFileContentMD5', function (done) {
      var fileName = testutil.generateId(fileNamesPrefix, fileName, suite.isMocked) + ' a';
      var fileText = 'Hello World';
      var fileMD5 = azureutil.getContentMd5(fileText);

      fileService.createFileFromText(shareName, directoryName, fileName, fileText, {storeFileContentMD5: true, contentSettings: { contentMD5: fileMD5 }}, function (uploadError, file, uploadResponse) {
        assert.equal(uploadError, null);
        assert.notEqual(file, null);
        assert.ok(uploadResponse.isSuccessful);
        
        fileService.getFileProperties(shareName, directoryName, fileName, function (getPropError, properties) {
          assert.equal(getPropError, null);
          assert.equal(properties.contentSettings.contentMD5, fileMD5);
          fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, fileTextResponse) {
            assert.equal(downloadErr, null);
            assert.equal(fileTextResponse, fileText);
  
            done();
          });
        });
      });
    });
  });

  if (!azureutil.isBrowser()) {
    describe('createFileFromFile', function() {
      var fileText = 'Hello World!';
      var zeroFileContentMD5;
      var fileContentMD5;
      before(function (done) {
        fileContentMD5 = writeFile(localFileName, fileText);
        var zeroBuffer = Buffer.alloc(0);
        zeroFileContentMD5 = writeFile(zeroSizeFileName, zeroBuffer);
        done();
      });
  
      afterEach(function (done) {
        fileService.deleteFileIfExists(shareName, directoryName, fileName, function (err) {
          assert.equal(err, null);
          done();
        });
      });
  
      skipBrowser('should work with basic file', function(done) {
        fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, function (err, file) {
          assert.equal(err, null);
          assert.equal(file.share, shareName);
          assert.equal(file.directory, directoryName);
          assert.equal(file.name, fileName);
  
          fileService.getFileProperties(shareName, directoryName, fileName, function (err, file) {
            assert.equal(file.contentSettings, undefined);
  
            fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, fileTextResponse) {
              assert.equal(downloadErr, null);
              assert.equal(fileTextResponse, fileText);
              done();
            });
          });
        });
      });
  
      skipBrowser('should work with speed summary', function(done) {
        var speedSummary = fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, function (err) {
          assert.equal(err, null);
  
          fileService.getFileProperties(shareName, directoryName, fileName, function (err1, file) {
            assert.equal(err1, null);
            assert.equal(file.contentSettings, undefined);
            assert.equal(speedSummary.getTotalSize(false), fileText.length);
            assert.equal(speedSummary.getCompleteSize(false), fileText.length);
            assert.equal(speedSummary.getCompletePercent(), '100.0');
            done();
          });
        });
      });
  
      skipBrowser('should set content md5', function(done) {
        var options = {
          storeFileContentMD5 : true,
          useTransactionalMD5 : true
        };
  
        fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, options, function (err) {
          assert.equal(err, null);
  
          fileService.getFileProperties(shareName, directoryName, fileName, function (getErr, file) {
            assert.equal(getErr, null);
            assert.equal(file.contentSettings.contentMD5, fileContentMD5);
            done();
          });
        });
      });
  
      skipBrowser('should overwrite the existing file', function(done) {
        fileService.createFileFromText(shareName, directoryName, fileName, 'garbage', function (err) {
          assert.equal(err, null);
          fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, function (err) {
            assert.equal(err, null);
  
            fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, fileTextResponse) {
              assert.equal(downloadErr, null);
              assert.equal(fileTextResponse, fileText);
              done();
            });
          });
        });
      });
  
      skipBrowser('should work with content type', function (done) {
        var fileOptions = { contentSettings: { contentType: 'text' }};
        fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, fileOptions, function (uploadError, fileResponse, uploadResponse) {
          assert.equal(uploadError, null);
          assert.notEqual(fileResponse, null);
          assert.ok(uploadResponse.isSuccessful);
  
          fileService.getFileProperties(shareName, directoryName, fileName, function (getFilePropertiesErr, fileGetResponse) {
            assert.equal(getFilePropertiesErr, null);
            assert.notEqual(fileGetResponse, null);
            assert.equal(fileOptions.contentSettings.contentType, fileGetResponse.contentSettings.contentType);
            done();
          });
        });
      });
  
      skipBrowser('should work with zero size file', function(done) {
        var fileOptions = {storeFileContentMD5: true};
        fileService.createFileFromLocalFile(shareName, directoryName, fileName, zeroSizeFileName, fileOptions, function (err1) {
          assert.equal(err1, null);
  
          fileService.getFileProperties(shareName, directoryName, fileName, function (err2, file) {
            assert.equal(err2, null);
            assert.equal(file.contentLength, 0);
            assert.equal(file.contentSettings.contentMD5, zeroFileContentMD5);
            done();
          });
        });
      });
  
      skipBrowser('should work with not existing file', function(done) {
        fileService.createFileFromLocalFile(shareName, directoryName, fileName, notExistFileName, function (err) {
          assert.notEqual(err, null);
          assert.equal(path.basename(err.path), notExistFileName);
  
          fileService.doesFileExist(shareName, directoryName, fileName, function (existsErr, existsResult) {
            assert.equal(existsErr, null);
            assert.equal(existsResult.exists, false);
            done();
          });
        });
      });
    });
  
    describe('createFileFromStream', function() {
      var fileText = 'Hello World!';
      var zeroFileContentMD5;
      var fileContentMD5;
      var len;
      var stream;
  
      before(function (done) {
        fileContentMD5 = writeFile(localFileName, fileText);
        var zeroBuffer = Buffer.alloc(0);
        zeroFileContentMD5 = writeFile(zeroSizeFileName, zeroBuffer);
        done();
      });
  
      beforeEach(function (done) {
        len = Buffer.byteLength(fileText);
        stream = rfs.createReadStream(localFileName);
        done();
      });
  
      afterEach(function (done) {
        fileService.deleteFileIfExists(shareName, directoryName, fileName, function(error) {
          done();
        });
      });
  
      skipBrowser('should work with basic stream', function(done) {   
        var stream = rfs.createReadStream(localFileName);   
        fileService.createFileFromStream(shareName, directoryName, fileName, stream, fileText.length, function (err, file) { 
          assert.equal(err, null);
          assert.equal(file.share, shareName);
          assert.equal(file.directory, directoryName);
          assert.equal(file.name, fileName);
  
          fileService.getFileProperties(shareName, directoryName, fileName, function (err1, file) {
            assert.equal(err1, null);
            assert.equal(file.contentSettings, undefined);
  
            fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, fileTextResponse) {
              assert.equal(downloadErr, null);
              assert.equal(fileTextResponse, fileText);
              done();
            });
          });
        });
      });
  
      skipBrowser('should work with contentMD5 in options', function(done) {
        var options = {
          contentSettings: {
            contentMD5: fileContentMD5
          }
        };
  
        fileService.createFileFromStream(shareName, directoryName, fileName, stream, len, options, function (err) {
          assert.equal(err, null);
          fileService.getFileProperties(shareName, directoryName, fileName, function (err, file) {
            assert.equal(file.contentSettings.contentMD5, fileContentMD5);
            done();
          });
        });
      });
  
      skipBrowser('should work with the speed summary in options', function(done) {
        var speedSummary = new azure.FileService.SpeedSummary();
        var options = {
          speedSummary : speedSummary
        };
  
        fileService.createFileFromStream(shareName, directoryName, fileName, stream, len, options, function (err) {
          assert.equal(err, null);
          assert.equal(speedSummary.getTotalSize(false), Buffer.byteLength(fileText));
          assert.equal(speedSummary.getCompleteSize(false), Buffer.byteLength(fileText));
          assert.equal(speedSummary.getCompletePercent(), '100.0');
          done();
        });
      });
  
      skipBrowser('should work with content type', function (done) {
        var fileOptions = { contentSettings: { contentType: 'text' }};
  
        fileService.createFileFromStream(shareName, directoryName, fileName, rfs.createReadStream(localFileName), fileText.length, fileOptions, function (uploadError, fileResponse, uploadResponse) {
          assert.equal(uploadError, null);
          assert.notEqual(fileResponse, null);
          assert.ok(uploadResponse.isSuccessful);
  
          fileService.getFileToText(shareName, directoryName, fileName, function (downloadErr, fileTextResponse) {
            assert.equal(downloadErr, null);
            assert.equal(fileTextResponse, fileText);
  
            fileService.getFileProperties(shareName, directoryName, fileName, function (getFilePropertiesErr, fileGetResponse) {
              assert.equal(getFilePropertiesErr, null);
              assert.notEqual(fileGetResponse, null);
              assert.equal(fileOptions.contentSettings.contentType, fileGetResponse.contentSettings.contentType);
  
              done();
            });
          });
        });
      });
  
      skipMockAndBrowser('should work with parallelOperationsThreadCount in options', function(done) {
        var options = { parallelOperationThreadCount : 4 };
        var buffer = Buffer.alloc(65 * 1024 * 1024);
        buffer.fill(0);
        buffer[0] = '1';
        writeFile(localFileName, buffer);
        var stream = rfs.createReadStream(localFileName);
        
        fileService.createFileFromStream(shareName, directoryName, fileName, stream, buffer.length, options, function (err) {
          assert.equal(err, null);
  
          fileService.getFileProperties(shareName, directoryName, fileName, function (getFilePropertiesErr, fileGetResponse) {
            assert.equal(getFilePropertiesErr, null);
            assert.notEqual(fileGetResponse, null);
            assert.equal(fileGetResponse.contentLength, buffer.length);
  
            done();
          });
        });
      });
    });
  }

  describe('MD5Validation', function() {
    var callback = function (webresource) {
      if (webresource.headers[HeaderConstants.CONTENT_LENGTH]) {
        assert.notEqual(webresource.headers[HeaderConstants.CONTENT_MD5], null);
      }
    };

    skipMockAndBrowser('storeFileContentMD5/useTransactionalMD5 on file', function (done) {
      var fileBuffer = Buffer.alloc(5 * 1024 * 1024);
      fileBuffer.fill(0);
      fileBuffer[0] = '1';
      var fileMD5 = writeFile(localFileName, fileBuffer);

      var fileOptions = {storeFileContentMD5: true, useTransactionalMD5: true, contentSettings: { contentType: 'text' }};
      fileService.on('sendingRequestEvent', callback);
      fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, fileOptions, function (uploadError, fileResponse, uploadResponse) {
        fileService.removeAllListeners('sendingRequestEvent');
        assert.equal(uploadError, null);
        assert.notEqual(fileResponse, null);
        assert.ok(uploadResponse.isSuccessful);

        // Set disableContentMD5Validation to false explicitly.
        fileService.getFileToLocalFile(shareName, directoryName, fileName, downloadFileName, function (downloadErr, downloadResult) {
          assert.equal(downloadErr, null);
          assert.strictEqual(downloadResult.contentSettings.contentMD5, fileMD5);

          fileService.getFileProperties(shareName, directoryName, fileName, function (getFilePropertiesErr, fileGetResult) {
            assert.equal(getFilePropertiesErr, null);
            assert.notEqual(fileGetResult, null);
            assert.equal(fileOptions.contentSettings.contentType, fileGetResult.contentSettings.contentType);
            assert.notEqual(fileGetResult.contentSettings.contentMD5, null);

            done();
          });
        });
      });
    });
    
    skipBrowser('storeFileContentMD5/useTransactionalMD5 with streams/ranges', function (done) {
      var fileBuffer = Buffer.alloc(5 * 1024 * 1024);
      fileBuffer.fill(0);
      fileBuffer[0] = '1';
      var fileMD5 = writeFile(localFileName, fileBuffer);

      var fileOptions = {storeFileContentMD5: true, useTransactionalMD5: true, contentSettings: { contentType: 'text' }};
      fileService.on('sendingRequestEvent', callback);
      fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, fileOptions, function (uploadError, fileResponse, uploadResponse) {
        fileService.removeAllListeners('sendingRequestEvent');
        assert.equal(uploadError, null);
        assert.notEqual(fileResponse, null);
        assert.ok(uploadResponse.isSuccessful);

        var downloadOptions = { rangeStart: 512, rangeEnd: 1023 };
        fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), downloadOptions, function (downloadErr1, downloadResult1) {
          assert.equal(downloadErr1, null);
          assert.strictEqual(parseInt(downloadResult1.contentLength, 10), 512);
          assert.strictEqual(downloadResult1.contentSettings.contentMD5, 'ndpxhuSh0PPmMvK74fkYvg==');

          downloadOptions.useTransactionalMD5 = true
          fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), downloadOptions, function (downloadErr2, downloadResult2) {
            assert.equal(downloadErr2, null);
            assert.strictEqual(parseInt(downloadResult2.contentLength, 10), 512);
            assert.strictEqual(downloadResult2.contentSettings.contentMD5, 'ndpxhuSh0PPmMvK74fkYvg==');

            done();
          });
        });
      });
    });
  
    it('storeFileContentMD5/useTransactionalMD5 with text', function (done) {
      var data1 = 'Hello, World!';

      var fileOptions = {storeFileContentMD5: true, useTransactionalMD5: true};
      fileService.on('sendingRequestEvent', callback);
      fileService.createFileFromText(shareName, directoryName, fileName, data1, fileOptions, function (err) {
        fileService.removeAllListeners('sendingRequestEvent');
        assert.equal(err, null);

        fileService.getFileToText(shareName, directoryName, fileName, function (err2, content, result) {
          assert.equal(err2, null);
          assert.equal(content, 'Hello, World!');
          assert.equal(result.contentSettings.contentMD5, 'ZajifYh5KDgxtmS9i38K1A==');
          
          fileService.getFileProperties(shareName, directoryName, fileName, function (getFilePropertiesErr, file) {
            assert.equal(getFilePropertiesErr, null);
            assert.equal(file.contentSettings.contentMD5, 'ZajifYh5KDgxtmS9i38K1A==');
            done();
          });
        });
      });
    });

    skipMockAndBrowser('disableContentMD5Validation', function (done) {
      var fileBuffer = Buffer.alloc(5 * 1024 * 1024);
      fileBuffer.fill(0);
      fileBuffer[0] = '1';
      var fileMD5 = writeFile(localFileName, fileBuffer);

      var fileOptions = { contentType: 'text'};
      fileService.createFileFromLocalFile(shareName, directoryName, fileName, localFileName, fileOptions, function (uploadError, fileResponse, uploadResponse) {
        assert.equal(uploadError, null);
        assert.notEqual(fileResponse, null);
        assert.ok(uploadResponse.isSuccessful);

        var properties = {contentMD5: 'MDAwMDAwMDA='};
        fileService.setFileProperties(shareName, directoryName, fileName, properties, function (setFilePropertiesErr) {
          assert.equal(setFilePropertiesErr, null);

          fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), { disableContentMD5Validation: false }, function (downloadErr) {
            assert.notEqual(downloadErr, null);
            assert.equal(downloadErr.message, util.format(SR.HASH_MISMATCH, 'MDAwMDAwMDA=', 'ndpxhuSh0PPmMvK74fkYvg=='));

            fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), function (downloadErr2) {
              assert.notEqual(downloadErr2, null);
              assert.equal(downloadErr2.message, util.format(SR.HASH_MISMATCH, 'MDAwMDAwMDA=', 'ndpxhuSh0PPmMvK74fkYvg=='));

              fileService.getFileToStream(shareName, directoryName, fileName, fs.createWriteStream(downloadFileName), { disableContentMD5Validation: true }, function (downloadErr3) {
                assert.equal(downloadErr3, null);

                done();
              });
            });
          });
        });
      });
    });
  });

  describe('cleanup file upload-download test', function () {
    it('should delete the test share', function (done) {
      fileService.deleteShareIfExists(shareName, function (deleteError) {
        assert.equal(deleteError, null);
        done();
      });
    });
  });
});