'use strict'

const mqtt = require('mqtt')
const client  = mqtt.connect('mqtt://zwavepi:cbj32KJ12h!25jNg^*@172.19.10.11')

client.on('connect', function () {
  client.subscribe('sensors');
  client.subscribe('outlets');
  client.subscribe('lights');
});

client.on('message', function (topic, message) {
  // message is Buffer
  console.log(message.toString());
});
