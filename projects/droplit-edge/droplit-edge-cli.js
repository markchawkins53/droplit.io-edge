'use strict';

var fs = require ('fs');
var path = require ('path');
var settingsPath = path.join(__dirname, 'localsettings.json');
fs.readFile(settingsPath, function (err, data){
    var localsettings = JSON.parse(data.toString ());

    var prompt = require('prompt');
    
    prompt.start ();
    prompt.get(['eID'], function (err, result) {
        localsettings.ecosystemId = result.eID;
        fs.writeFile(settingsPath, JSON.stringify(localsettings, null, '\t'), function (err) {
            var server = require ('./server.js');
        });
    });
});
