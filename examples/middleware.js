'use strict';

var express = require('express'),
    app = express(),
    errorHandler = require('errorhandler'),

    pubSubHubbub = require('../src/pubsubhubbub'),

    PORT = 1337,
    HOST = 'kreata.ee',
    PATH = '/pubSubHubbub',

    pubsub = pubSubHubbub.createServer({
        callbackUrl: 'http://' + HOST + (PORT && PORT !== 80 ? ':' + PORT : '') + PATH,
        secret: 'MyTopSecret'
    }),

    topic = 'http://testetstetss.blogspot.com/feeds/posts/default',
    hub = 'http://pubsubhubbub.appspot.com/';

app.use(PATH, pubsub.listener());

// default response
app.get('/', function(req, res) {
    res.send('hello world');
});

errorHandler.title = 'PubSubHubbub test';
app.use(errorHandler());

app.listen(PORT, function(){
    console.log('Server listening on port %s', PORT);
    pubsub.subscribe(topic, hub);
});

pubsub.on('denied', function(data){
    console.log('Denied');
    console.log(data);
});

pubsub.on('subscribe', function(data){
    console.log('Subscribe');
    console.log(data);

    console.log('Subscribed '+topic+' to '+hub);
});

pubsub.on('unsubscribe', function(data){
    console.log('Unsubscribe');
    console.log(data);

    console.log('Unsubscribed '+topic+' from '+hub);
});

pubsub.on('error', function(error){
    console.log('Error');
    console.log(error);
});

pubsub.on('feed', function(data){
    console.log(data);
    console.log(data.feed.toString());

    pubsub.unsubscribe(topic, hub);
});
