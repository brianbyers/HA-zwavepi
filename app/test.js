'use strict'

const async = require('async')

const redis = require("redis")
const client = redis.createClient({host: '172.19.10.11'})

client.hgetall('zwave:node:8:classes', (err, result) => {
  // console.log(result);
  var keys = Object.keys(result);
  // console.log(keys);
  keys.forEach((key) => {
    // console.log(key)
    console.log(key.split(':')[0])
  })
  // async.forEach(result, function(obj) {
  //   console.log(Object.keys(obj));
  // });
});
