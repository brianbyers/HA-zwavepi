'use strict'

const mqtt = require('mqtt')
const client  = mqtt.connect('mqtt://zwavepi:cbj32KJ12h!25jNg^*@172.19.10.11')

client.on('connect', function () {
  // setInterval(function () {
    client.publish('action-outlets', JSON.stringify({'outlet': 'landingOutlet', 'state': 'on'}));
  // }, 1000);
});
