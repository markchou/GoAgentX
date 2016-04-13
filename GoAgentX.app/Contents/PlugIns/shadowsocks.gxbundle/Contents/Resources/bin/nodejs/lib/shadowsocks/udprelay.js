// Generated by CoffeeScript 1.7.1

/*
  Copyright (c) 2014 clowwindy
  
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  
  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.
  
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
 */

(function() {
  var LRUCache, decrypt, dgram, encrypt, encryptor, inet, net, parseHeader, utils;

  utils = require('./utils');

  inet = require('./inet');

  encryptor = require('./encrypt');

  dgram = require('dgram');

  net = require('net');

  LRUCache = (function() {
    function LRUCache(timeout, sweepInterval) {
      var sweepFun, that;
      this.timeout = timeout;
      that = this;
      sweepFun = function() {
        return that.sweep();
      };
      this.interval = setInterval(sweepFun, sweepInterval);
      this.dict = {};
    }

    LRUCache.prototype.setItem = function(key, value) {
      var cur;
      cur = process.hrtime();
      return this.dict[key] = [value, cur];
    };

    LRUCache.prototype.getItem = function(key) {
      var v;
      v = this.dict[key];
      if (v) {
        v[1] = process.hrtime();
        return v[0];
      }
      return null;
    };

    LRUCache.prototype.delItem = function(key) {
      return delete this.dict[key];
    };

    LRUCache.prototype.destroy = function() {
      return clearInterval(this.interval);
    };

    LRUCache.prototype.sweep = function() {
      var dict, diff, k, keys, swept, v, v0, _i, _len;
      utils.debug("sweeping");
      dict = this.dict;
      keys = Object.keys(dict);
      swept = 0;
      for (_i = 0, _len = keys.length; _i < _len; _i++) {
        k = keys[_i];
        v = dict[k];
        diff = process.hrtime(v[1]);
        if (diff[0] > this.timeout * 0.001) {
          swept += 1;
          v0 = v[0];
          v0.close();
          delete dict[k];
        }
      }
      return utils.debug("" + swept + " keys swept");
    };

    return LRUCache;

  })();

  encrypt = function(password, method, data) {
    var e;
    try {
      return encryptor.encryptAll(password, method, 1, data);
    } catch (_error) {
      e = _error;
      utils.error(e);
      return null;
    }
  };

  decrypt = function(password, method, data) {
    var e;
    try {
      return encryptor.encryptAll(password, method, 0, data);
    } catch (_error) {
      e = _error;
      utils.error(e);
      return null;
    }
  };

  parseHeader = function(data, requestHeaderOffset) {
    var addrLen, addrtype, destAddr, destPort, e, headerLength;
    try {
      addrtype = data[requestHeaderOffset];
      if (addrtype === 3) {
        addrLen = data[requestHeaderOffset + 1];
      } else if (addrtype !== 1 && addrtype !== 4) {
        utils.warn("unsupported addrtype: " + addrtype);
        return null;
      }
      if (addrtype === 1) {
        destAddr = utils.inetNtoa(data.slice(requestHeaderOffset + 1, requestHeaderOffset + 5));
        destPort = data.readUInt16BE(requestHeaderOffset + 5);
        headerLength = requestHeaderOffset + 7;
      } else if (addrtype === 4) {
        destAddr = inet.inet_ntop(data.slice(requestHeaderOffset + 1, requestHeaderOffset + 17));
        destPort = data.readUInt16BE(requestHeaderOffset + 17);
        headerLength = requestHeaderOffset + 19;
      } else {
        destAddr = data.slice(requestHeaderOffset + 2, requestHeaderOffset + 2 + addrLen).toString("binary");
        destPort = data.readUInt16BE(requestHeaderOffset + 2 + addrLen);
        headerLength = requestHeaderOffset + 2 + addrLen + 2;
      }
      return [addrtype, destAddr, destPort, headerLength];
    } catch (_error) {
      e = _error;
      utils.error(e);
      return null;
    }
  };

  exports.createServer = function(listenAddr, listenPort, remoteAddr, remotePort, password, method, timeout, isLocal) {
    var clientKey, clients, listenIPType, server, udpTypeToListen, udpTypesToListen, _i, _len;
    udpTypesToListen = [];
    if (listenAddr == null) {
      udpTypesToListen = ['udp4', 'udp6'];
    } else {
      listenIPType = net.isIP(listenAddr);
      if (listenIPType === 6) {
        udpTypesToListen.push('udp6');
      } else {
        udpTypesToListen.push('udp4');
      }
    }
    for (_i = 0, _len = udpTypesToListen.length; _i < _len; _i++) {
      udpTypeToListen = udpTypesToListen[_i];
      server = dgram.createSocket(udpTypeToListen);
      clients = new LRUCache(timeout, 10 * 1000);
      clientKey = function(localAddr, localPort, destAddr, destPort) {
        return "" + localAddr + ":" + localPort + ":" + destAddr + ":" + destPort;
      };
      server.on("message", function(data, rinfo) {
        var addrtype, client, clientUdpType, dataToSend, destAddr, destPort, frag, headerLength, headerResult, key, requestHeaderOffset, sendDataOffset, serverAddr, serverPort, _ref, _ref1;
        requestHeaderOffset = 0;
        if (isLocal) {
          requestHeaderOffset = 3;
          frag = data[2];
          if (frag !== 0) {
            utils.debug("frag:" + frag);
            utils.warn("drop a message since frag is not 0");
            return;
          }
        } else {
          data = decrypt(password, method, data);
          if (data == null) {
            return;
          }
        }
        headerResult = parseHeader(data, requestHeaderOffset);
        if (headerResult === null) {
          return;
        }
        addrtype = headerResult[0], destAddr = headerResult[1], destPort = headerResult[2], headerLength = headerResult[3];
        if (isLocal) {
          sendDataOffset = requestHeaderOffset;
          _ref = [remoteAddr, remotePort], serverAddr = _ref[0], serverPort = _ref[1];
        } else {
          sendDataOffset = headerLength;
          _ref1 = [destAddr, destPort], serverAddr = _ref1[0], serverPort = _ref1[1];
        }
        key = clientKey(rinfo.address, rinfo.port, destAddr, destPort);
        client = clients.getItem(key);
        if (client == null) {
          clientUdpType = net.isIP(serverAddr);
          if (clientUdpType === 6) {
            client = dgram.createSocket("udp6");
          } else {
            client = dgram.createSocket("udp4");
          }
          clients.setItem(key, client);
          client.on("message", function(data1, rinfo1) {
            var data2, responseHeader, serverIPBuf;
            if (!isLocal) {
              utils.debug("UDP recv from " + rinfo1.address + ":" + rinfo1.port);
              serverIPBuf = utils.inetAton(rinfo1.address);
              responseHeader = new Buffer(7);
              responseHeader.write('\x01', 0);
              serverIPBuf.copy(responseHeader, 1, 0, 4);
              responseHeader.writeUInt16BE(rinfo1.port, 5);
              data2 = Buffer.concat([responseHeader, data1]);
              data2 = encrypt(password, method, data2);
              if (data2 == null) {
                return;
              }
            } else {
              responseHeader = new Buffer("\x00\x00\x00");
              data1 = decrypt(password, method, data1);
              if (data1 == null) {
                return;
              }
              headerResult = parseHeader(data1, 0);
              if (headerResult === null) {
                return;
              }
              addrtype = headerResult[0], destAddr = headerResult[1], destPort = headerResult[2], headerLength = headerResult[3];
              utils.debug("UDP recv from " + destAddr + ":" + destPort);
              data2 = Buffer.concat([responseHeader, data1]);
            }
            return server.send(data2, 0, data2.length, rinfo.port, rinfo.address, function(err, bytes) {
              return utils.debug("remote to local sent");
            });
          });
          client.on("error", function(err) {
            return utils.error("UDP client error: " + err);
          });
          client.on("close", function() {
            utils.debug("UDP client close");
            return clients.delItem(key);
          });
        }
        utils.debug("pairs: " + (Object.keys(clients.dict).length));
        dataToSend = data.slice(sendDataOffset, data.length);
        if (isLocal) {
          dataToSend = encrypt(password, method, dataToSend);
          if (dataToSend == null) {
            return;
          }
        }
        utils.debug("UDP send to " + destAddr + ":" + destPort);
        return client.send(dataToSend, 0, dataToSend.length, serverPort, serverAddr, function(err, bytes) {
          return utils.debug("local to remote sent");
        });
      });
      server.on("listening", function() {
        var address;
        address = server.address();
        return utils.info("UDP server listening " + address.address + ":" + address.port);
      });
      server.on("close", function() {
        utils.info("UDP server closing");
        return clients.destroy();
      });
      if (listenAddr != null) {
        server.bind(listenPort, listenAddr);
      } else {
        server.bind(listenPort);
      }
      return server;
    }
  };

}).call(this);
