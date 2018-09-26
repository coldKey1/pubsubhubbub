'use strict';

var request = require('request'),
    http = require('http'),
    urllib = require('url'),
    Stream = require('stream').Stream,
    utillib = require('util'),
    crypto = require('crypto');

// Expose to the world
/**
 * Creates a PubSubHubbub subscriber service as a HTTP server.
 * Usage:
 *     pubsub = createServer(options);
 *     pubsub.listen(1337);
 *
 * @param {Object} [options] Options object
 * @param {String} [options.callbackUrl] Callback URL for the hub
 * @param {String} [options.secret] Secret value for HMAC signatures
 * @param {Number} [options.maxContentSize] Maximum allowed size of the POST messages
 * @param {String} [options.username] Username for HTTP Authentication
 * @param {String} [options.password] Password for HTTP Authentication
 * @param {String} [headers] Custom headers to use for all HTTP requests
 * @return {Object} A PubSubHubbub server object
 */
module.exports.createServer = function (options) {
    return new PubSubHubbub(options);
};

/**
 * Create a PubSubHubbub client handler object. HTTP server is set up to listen
 * the responses from the hubs.
 *
 * @constructor
 * @param {Object} [options] Options object
 * @param {String} [options.callbackUrl] Callback URL for the hub
 * @param {String} [options.secret] Secret value for HMAC signatures
 * @param {Number} [options.maxContentSize] Maximum allowed size of the POST messages
 * @param {String} [options.username] Username for HTTP Authentication
 * @param {String} [options.password] Password for HTTP Authentication
 * @param {String} [headers] Custom headers to use for all HTTP requests
 */
function PubSubHubbub(options) {
    Stream.call(this);

    options = options || {};

    this.headers = options.headers || {};
    this.secret = options.secret || false;
    this.callbackUrl = options.callbackUrl || '';
    this.maxContentSize = options.maxContentSize || 3 * 1024 * 1024;

    if (options.username) {
        this.auth = {
            'user': options.username,
            'pass': options.password,
            'sendImmediately': options.sendImmediately || false
        };
    }
}
utillib.inherits(PubSubHubbub, Stream);

// PUBLIC API

/**
 * Creates an Express middleware handler for PubSubHubbub
 *
 * @param  {Object}   req HTTP request object
 * @param  {Object}   res HTTP response object
 * @param  {Function} next Optional connect middleware next()
 * @return {Function} Middleware handler
 */
PubSubHubbub.prototype.listener = function () {
    return function (req, res, next) {
        this._onRequest(req, res, next);
    }.bind(this);
};

/**
 * Start listening on selected port
 *
 * Uses the same arguments as http#listen (port, host, callback)
 */
PubSubHubbub.prototype.listen = function () {
    var args = Array.prototype.slice.call(arguments);
    this.port = args[0];

    this.server = http.createServer(this._onRequest.bind(this));
    this.server.on('error', this._onError.bind(this));
    this.server.on('listening', this._onListening.bind(this));

    this.server.listen.apply(this.server, args);
};

/**
 * Subsribe for a topic at selected hub
 *
 * @param {String} topic Atom or RSS feed URL
 * @param {String} hub Hub URL
 * @param {String} [callbackUrl] Define callback url for the hub, do not use the default
 * @param {Function} [callback] Callback function, might not be very useful
 */
PubSubHubbub.prototype.subscribe = function (topic, hub, lease_seconds, link_id, callbackUrl, callback) {
    this.setSubscription('subscribe', topic, hub, lease_seconds, link_id, callbackUrl, callback);
};

/**
 * Subsribe a topic at selected hub
 *
 * @param {String} topic Atom or RSS feed URL
 * @param {String} hub Hub URL
 * @param {String} [callbackUrl] Define callback url for the hub, do not use the default
 * @param {Function} [callback] Callback function, might not be very useful
 */
PubSubHubbub.prototype.unsubscribe = function (topic, hub, lease_seconds, callbackUrl, callback) {
    this.setSubscription('unsubscribe', topic, hub, lease_seconds, callbackUrl, callback);
};

/**
 * Subsribe or unsubscribe a topic at selected hub
 *
 * @param {String} mode Either 'subscribe' or 'unsubscribe'
 * @param {String} topic Atom or RSS feed URL
 * @param {String} hub Hub URL
 * @param {String} [callbackUrl] Define callback url for the hub, do not use the default
 * @param {Function} [callback] Callback function, might not be very useful
 */
PubSubHubbub.prototype.setSubscription = function (mode, topic, hub, lease_seconds, link_id, callbackUrl, callback) {

    if (!callback && typeof callbackUrl === 'function') {
        callback = callbackUrl;
        callbackUrl = undefined;
    }

    // by default the topic url is added as a GET parameter to the callback url
    callbackUrl = callbackUrl || this.callbackUrl +
        (this.callbackUrl.replace(/^https?:\/\//i, '').match(/\//) ? '' : '/') +
        (this.callbackUrl.match(/\?/) ? '&' : '?') +
        'topic=' + encodeURIComponent(topic) +
        '&link_id=' + link_id +
        '&hub=' + encodeURIComponent(hub);

    var form = {
        'hub.callback': callbackUrl,
        'hub.mode': mode,
        'hub.topic': topic,
        'hub.verify': 'async'
    }
    if (lease_seconds) {
        form['hub.lease_seconds'] = lease_seconds;
    }
    var postParams = {
        url: hub,
        headers: this.headers,
        form: form,
        encoding: 'utf-8'
    };

    if (this.auth) {
        postParams.auth = this.auth;
    }

    if (this.secret) {
        // do not use the original secret but a generated one
        form['hub.secret'] = crypto.createHmac('sha1', this.secret).update(topic).digest('hex');
    }

    request.post(postParams, function (error, response, responseBody) {

        if (error) {
            if (callback) {
                return callback(error);
            } else {
                return this.emit('denied', {
                    topic: topic,
                    error: error
                });
            }
        }

        if (response.statusCode !== 202 && response.statusCode !== 204) {
            var err = new Error('Invalid response status ' + response.statusCode);
            err.responseBody = (responseBody || '').toString();
            if (callback) {
                return callback(err);
            } else {
                return this.emit('denied', {
                    topic: topic,
                    error: err
                });
            }
        }

        return callback && callback(null, topic);
    });
};

// PRIVATE API

/**
 * Request handler. Will be fired when a client (hub) opens a connection to the server
 *
 * @event
 * @param {Object} req HTTP Request object
 * @param {Object} res HTTP Response object
 * @param {Function} next Optional connect middleware next()
 */
PubSubHubbub.prototype._onRequest = function (req, res, next) {
    switch (req.method) {
        case 'GET':
            return this._onGetRequest(req, res, next);
        case 'POST':
            return this._onPostRequest(req, res, next);
        default:
            return this._sendError(req, res, next, 405, 'Method Not Allowed');
    }
};

/**
 * Error event handler for the HTTP server
 *
 * @event
 * @param {Error} error Error object
 */
PubSubHubbub.prototype._onError = function (error) {
    if (error.syscall === 'listen') {
        error.message = 'Failed to start listening on port ' + this.port + ' (' + error.code + ')';
        this.emit('error', error);
    } else {
        this.emit('error', error);
    }
};

/**
 * Will be fired when HTTP server has successfully started listening on the selected port
 *
 * @event
 */
PubSubHubbub.prototype._onListening = function () {
    this.emit('listen');
};

/**
 * GET request handler for the HTTP server. This should be called when the server
 * tries to verify the intent of the subscriber.
 *
 * @param {Object} req HTTP Request object
 * @param {Object} res HTTP Response object
 * @param {Function} next Optional connect middleware next()
 */
PubSubHubbub.prototype._onGetRequest = function (req, res, next) {
    var params = urllib.parse(req.url, true, true),
        data;
    // Does not seem to be a valid PubSubHubbub request
    if (!params.query['hub.topic'] || !params.query['hub.mode']) {
        return this._sendError(req, res, next, 400, 'Bad Request');
    }

    switch (params.query['hub.mode']) {
        case 'denied':
            data = {
                topic: params.query['hub.topic'],
                hub: params.query.hub
            };
            if (next) {
                res.statusCode = 200;
                res.set('Content-Type', 'text/plain');
                res.send(params.query['hub.challenge'] || 'ok');
            } else {
                res.writeHead(200, {
                    'Content-Type': 'text/plain'
                });
                res.end(params.query['hub.challenge'] || 'ok');
            }
            break;
        case 'subscribe':
        case 'unsubscribe':
            data = {
                lease: Number(params.query['hub.lease_seconds'] || 0) + Math.round(Date.now() / 1000),
                lease_seconds: Number(params.query['hub.lease_seconds'] || 0) + Math.round(Date.now() / 1000),
                topic: params.query['hub.topic'],
                hub: params.query.hub,
                link_id: params.query.link_id
            };
            if (next) {
                res.statusCode = 200;
                res.set('Content-Type', 'text/plain');
                res.send(params.query['hub.challenge']);
            } else {
                res.writeHead(200, {
                    'Content-Type': 'text/plain'
                });
                res.end(params.query['hub.challenge']);
            }
            break;
        default:
            // Not a valid mode
            return this._sendError(req, res, next, 403, 'Forbidden');
    }

    // Emit subscription information
    this.emit(params.query['hub.mode'], data);
};

/**
 * POST request handler. Should be called when the hub tries to notify the subscriber
 * with new data
 *
 * @param {Object} req HTTP Request object
 * @param {Object} res HTTP Response object
 * @param {Function} next Optional connect middleware next()
 */
PubSubHubbub.prototype._onPostRequest = function (req, res, next) {
    var bodyChunks = [],
        params = urllib.parse(req.url, true, true),
        topic = params && params.query && params.query.topic,
        hub = params && params.query && params.query.hub,
        bodyLen = 0,
        tooLarge = false,
        signatureParts, algo, signature, hmac;

    // v0.4 hubs have a link header that includes both the topic url and hub url
    (req.headers && req.headers.link || '').
        replace(/<([^>]+)>\s*(?:;\s*rel=["']([^"']+)["'])?/gi, function (o, url, rel) {
            switch ((rel || '').toLowerCase()) {
                case 'self':
                    topic = url;
                    break;
                case 'hub':
                    hub = url;
                    break;
            }
        });

    if (!topic) {
        return this._sendError(req, res, next, 400, 'Bad Request');
    }

    // Hub must notify with signature header if secret specified.
    if (this.secret && !req.headers['x-hub-signature']) {
        return this._sendError(req, res, next, 403, 'Forbidden');
    }

    if (this.secret) {
        signatureParts = req.headers['x-hub-signature'].split('=');
        algo = (signatureParts.shift() || '').toLowerCase();
        signature = (signatureParts.pop() || '').toLowerCase();

        try {
            hmac = crypto.createHmac(algo, crypto.createHmac('sha1', this.secret).update(topic).digest('hex'));
        } catch (E) {
            return this._sendError(req, res, next, 403, 'Forbidden');
        }
    }

    req.on('data', (function (chunk) {
        if (!chunk || !chunk.length || tooLarge) {
            return;
        }

        if (bodyLen + chunk.length <= this.maxContentSize) {
            bodyChunks.push(chunk);
            bodyLen += chunk.length;
            if (this.secret) {
                hmac.update(chunk);
            }
        } else {
            tooLarge = true;
        }

        chunk = null;
    }).bind(this));

    req.on('end', (function () {
        if (tooLarge) {
            return this._sendError(req, res, next, 413, 'Request Entity Too Large');
        }

        // Must return 2xx code even if signature doesn't match.
        if (this.secret && hmac.digest('hex').toLowerCase() !== signature) {
            if (next) {
                res.statusCode = 202;
                res.set('Content-Type', 'text/plain; charset=utf-8');
                return res.send('');
            } else {
                res.writeHead(202, {
                    'Content-Type': 'text/plain; charset=utf-8'
                });
                return res.end();
            }
        }

        if (next) {
            res.statusCode = 204;
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.send('');
        } else {
            res.writeHead(204, {
                'Content-Type': 'text/plain; charset=utf-8'
            });
            res.end();
        }

        this.emit('feed', {
            topic: topic,
            hub: hub,
            callback: 'http://' + req.headers.host + req.url,
            feed: Buffer.concat(bodyChunks, bodyLen),
            headers: req.headers
        });

    }).bind(this));
};

/**
 * Generates and sends an error message as the response for a HTTP request
 *
 * @param {Object} req HTTP Request object
 * @param {Object} res HTTP Response object
 * @param {Function} next Optional connect middleware next()
 * @param {Number} code HTTP response status
 * @param {String} message Error message to display
 */
PubSubHubbub.prototype._sendError = function (req, res, next, code, message) {
    var err;
    if (next) {
        err = new Error(message);
        err.status = code;
        err.stack = ''; // hide stack
        return next(err);
    }
    res.writeHead(code, {
        'Content-Type': 'text/html'
    });
    res.end('<!DOCTYPE html>\n' +
        '<html>\n' +
        '    <head>\n' +
        '        <meta charset="utf-8"/>\n' +
        '        <title>' + code + ' ' + message + '</title>\n' +
        '    </head>\n' +
        '    <body>\n' +
        '        <h1>' + code + ' ' + message + '</h1>\n' +
        '    </body>\n' +
        '</html>');
};