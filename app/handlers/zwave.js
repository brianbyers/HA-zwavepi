'use strict'
const winston = require('winston')

function onDriverReady(homeid){
  winston.log('info', 'onDriverReady');
  winston.log('info', homeid);
  winston.log('info', 'scanning homeid=0x%s...', homeid.toString(16));
}

module.exports = {
  onDriverReady: onDriverReady
}
