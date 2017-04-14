'use strict'

const OZW = require('openzwave-shared')
const zwave = new OZW({
    Logging: true,     // disable file logging (OZWLog.txt)
    ConsoleOutput: true // enable console logging
});

const async = require('async')
const _ = require('lodash')
const winston = require('winston')

winston.add(winston.transports.File, { filename: '/home/pi/zwave.log' });
winston.remove(winston.transports.Console);


const mqtt = require('mqtt')
const mqttClient  = mqtt.connect(process.env.MQTT_URL)



var nodes = [];

zwave.on('driver ready', onDriverReady)
zwave.on('driver failed', onDriverFailed)
zwave.on('scan complete', onScanComplete)
zwave.on('node added', onNodeAdded)
zwave.on('node naming', onNodeNaming)
zwave.on('node available', onNodeAvailable)
zwave.on('node ready', onNodeReady)
zwave.on('node event', onNodeEvent);
zwave.on('polling enabled/disabled', onPollingEnabledDisabled)
zwave.on('scene event', onSceneEvent)
zwave.on('value added', onValueAdded)
zwave.on('value changed', onValueChanged)
zwave.on('value refreshed', onValueRefreshed)
zwave.on('value removed', onValueRemoved)
zwave.on('controller command', onControllerCommand)
zwave.on('notification', onNotification);

mqttClient.on('connect', function () {
  mqttClient.subscribe('action-outlets');
  mqttClient.subscribe('action-lights');
});

mqttClient.on('message', function (topic, message) {
  // message is Buffer
  // winston.log('info', message.toString());
  if (topic === 'action-outlets') {
    handleOutletAction(message);
  }

  if (topic === 'action-lights') {
    handleLightSwitchAction(message);
  }
});

const doorSensors = [
  {
    nodeId: 7,
    name: 'frontDoor'
  }
]

const motionSensors = [
  {
    nodeId: 8,
    name: 'multiSensor'
  }
]

const outlets = [
  {
    nodeId: 2,
    commandclass: 37,
    name: 'landingOutlet'
  },
  {
    nodeId: 4,
    commandclass: 37,
    name: 'outsideSwitch'
  }
]

const lights = [
  {
    nodeId: 5,
    commandclass: 37,
    name: 'garageMainLights'
  },
  {
    nodeId: 3,
    commandclass: 38,
    name: 'livingRoomLight',
    currentValue: null
  }
]

const multiSensors = [
  {
    nodeId: 8,
    keys: ['Temperature', 'Luminance', 'Relative Humidity', 'Ultraviolet', 'Low Battery', 'Battery Level', 'Burglar'],
    name: 'multiSensor'
  }
]

function handleOutletAction(message) {
  message = JSON.parse(message.toString())

  let outlet = _.find(outlets, (o) => {
    return o.name === message.outlet;
  });

  if (outlet) {
    if (message.state === 'on') {
      winston.log('info', 'turning outlet on', outlet.nodeId)
      zwave.setValue(outlet.nodeId, outlet.commandclass, 1, 0, true);
    } else {
      winston.log('info', 'turning outlet off', outlet.nodeId)
      zwave.setValue(outlet.nodeId, outlet.commandclass, 1, 0, false);
    }
  }
}

function handleLightSwitchAction(message) {
  message = JSON.parse(message.toString())
  winston.log('info', 'handleLightSwitchAction', message)

  let light = _.find(lights, (o) => {
    return o.name === message.lightSwitch;
  });

  if (light) {
    if (message.state === 'on') {
      if (message.level !== undefined) {
        winston.log('info', light.nodeId, light.commandclass, 1, 0, message.level);
        // winston.log('info', message.level);
        zwave.setValue(light.nodeId, light.commandclass, 1, 0, message.level);
      } else {
        zwave.setValue(light.nodeId, light.commandclass, 1, 0, true);
      }
    } else {
      winston.log('info', 'turning light off', light.nodeId)
      zwave.setValue(light.nodeId, light.commandclass, 1, 0, false);
    }
  }
}

function sendDoorSensorMessage(nodeid, nodeData) {
    var message = {
      sensorId: _.find(doorSensors, {nodeId: nodeid}).name,
      timestamp: new Date()
    };

    if (nodeData === 0) {
      //door closed
      message.state = 'closed'
    } else {
      //door open
      message.state = 'open'
    }

    mqttClient.publish('sensors', JSON.stringify(message));
}

function sendMotionSensorMessage(nodeid, nodeData) {
    var message = {
      sensorId: _.find(motionSensors, {nodeId: nodeid}).name
    };

    if (nodeData === 0) {
      //door closed
      message.state = 'no motion'
    } else {
      //door open
      message.state = 'motion'
    }

    mqttClient.publish('motion', JSON.stringify(message));
}

function sendMultiSensorMessage(nodeid, nodeData) {
  let sensor = _.find(multiSensors, {nodeId: nodeid});
  let message = {
    sensorId: sensor.name,
    timestamp: new Date()
  };

  for (let comclass in nodes[nodeid]['classes']) {
      var values = nodes[nodeid]['classes'][comclass];
      // winston.log('info', 'node%d: class %d', nodeid, comclass);
      for (let idx in values) {
        // winston.log('info', 'node%d:   %s=%s', nodeid, values[idx]['label'], values[idx]['value']);

        let label = values[idx]['label'];
        let value = values[idx]['value'];
        if (_.find(sensor.keys, (key) => { return key === label})) {
          message[label] = value;
        }
      }
  }
  // winston.log('info', message);
  mqttClient.publish('sensors', JSON.stringify(message));
}

function sendOutletStatusMessage(nodeid, nodeData) {
  var message = {
    sensorId: _.find(outlets, {nodeId: nodeid}).name,
    timestamp: new Date()
  };

  if (nodeData.value === true) {
    message.state = 'on'
  } else {
    message.state = 'off'
  }

  mqttClient.publish('outlets', JSON.stringify(message));
}

function sendLightStatusMessage(nodeid, nodeData) {
  let light = _.find(lights, {nodeId: nodeid});
  var message = {
    sensorId: light.name,
    timestamp: new Date()
  };

  if (nodeData.value === true) {
    message.state = 'on';
  } else if (nodeData.value === false){
    message.state = 'off';
  } else {
    message.state = nodeData.value;
  }

  //update local cache
  if (light.currentValue !== nodeData.value) {
    light.currentValue = nodeData.value;
    mqttClient.publish('lights', JSON.stringify(message));
  }

}

function sendMessage(nodeid, commandclass, nodeData) {
  if (!mqttClient.connected) {
    winston.log('info', 'not connected to mqtt')
    return;
  }

  if (!nodes[nodeid].ready) {
    winston.log('info', 'node: ' + nodeid + " not ready")
    return;
  }

  //handle door sensors
  if (_.find(doorSensors, {nodeId: nodeid})) {
    sendDoorSensorMessage(nodeid, nodeData);
  }

  //handle motion sensors
  if (_.find(motionSensors, {nodeId: nodeid})) {
    sendMotionSensorMessage(nodeid, nodeData);
  }

  // handle outlets
  if (_.find(outlets, {nodeId: nodeid, commandclass: commandclass})) {
    sendOutletStatusMessage(nodeid, nodeData);
  }

  //handle multi sensors
  if (_.find(multiSensors, {nodeId: nodeid})) {
    sendMultiSensorMessage(nodeid, nodeData);
  }

  //handle lights switches
  if (_.find(lights, {nodeId: nodeid, commandclass: commandclass})) {
    sendLightStatusMessage(nodeid, nodeData);
  }
}



function onNodeEvent(nodeid, data) {
  winston.log('info', 'onNodeEvent');
  winston.log('info', nodeid);
  winston.log('info', data);

  sendMessage(nodeid, null, data);
}

function onDriverReady(homeid){
  winston.log('info', 'onDriverReady');
  winston.log('info', homeid);
  winston.log('info', 'scanning homeid=0x%s...', homeid.toString(16));
}

function onDriverFailed() {
  winston.log('info', 'failed to start driver');
  zwave.disconnect();
  process.exit();
}

function onScanComplete() {
  winston.log('info', 'onScanComplete');
  winston.log('info', 'network scan complete');
}

function onNodeAdded(nodeid) {
  nodes[nodeid] = {
      manufacturer: '',
      manufacturerid: '',
      product: '',
      producttype: '',
      productid: '',
      type: '',
      name: '',
      loc: '',
      classes: {},
      ready: false,
  };

  if (nodeid === 3 || nodeid === 5) {
    setInterval(function () {
        // zwave.refreshNodeInfo(nodeid);
    }, 5000);
  }

  if (nodeid === 7) {
    nodes[nodeid].ready = true;
  }
  // winston.log('info', 'onNodeAdded');
  // winston.log('info', 'node added: ' + nodeid);
}

function onNodeNaming(nodeid, nodeinfo) {
  // winston.log('info', 'onNodeNaming')
  // winston.log('info', nodeid);
  // winston.log('info', nodeinfo);
}

function onNodeAvailable(nodeid, nodeinfo){
  // winston.log('info', 'onNodeAvailable');
  // winston.log('info', nodeid);
  // winston.log('info', nodeinfo);
}

function onNodeReady(nodeid, nodeinfo){
  zwave.enablePoll(3, 38);
  zwave.enablePoll(5, 38);

  // winston.log('info', zwave.requestAllConfigParams(8));
  nodes[nodeid]['manufacturer'] = nodeinfo.manufacturer;
  nodes[nodeid]['manufacturerid'] = nodeinfo.manufacturerid;
  nodes[nodeid]['product'] = nodeinfo.product;
  nodes[nodeid]['producttype'] = nodeinfo.producttype;
  nodes[nodeid]['productid'] = nodeinfo.productid;
  nodes[nodeid]['type'] = nodeinfo.type;
  nodes[nodeid]['name'] = nodeinfo.name;
  nodes[nodeid]['loc'] = nodeinfo.loc;
  nodes[nodeid]['ready'] = true;

  if (nodeid !== 3 && nodeid !== 5) {
    winston.log('info', 'node%d: %s, %s', nodeid,
            nodeinfo.manufacturer ? nodeinfo.manufacturer
                      : 'id=' + nodeinfo.manufacturerid,
            nodeinfo.product ? nodeinfo.product
                     : 'product=' + nodeinfo.productid +
                       ', type=' + nodeinfo.producttype);
    winston.log('info', 'node%d: name="%s", type="%s", location="%s"', nodeid,
            nodeinfo.name,
            nodeinfo.type,
            nodeinfo.loc);
    for (let comclass in nodes[nodeid]['classes']) {
        var values = nodes[nodeid]['classes'][comclass];
        winston.log('info', 'node%d: class %d', nodeid, comclass);
        for (let idx in values)
            winston.log('info', 'node%d:   %s=%s', nodeid, values[idx]['label'], values[idx]['value']);
    }
  }

}

function onPollingEnabledDisabled(nodeid){
  winston.log('info', 'onPollingEnabledDisabled');
  winston.log('info', nodeid);
}

function onSceneEvent(nodeid, sceneid){
  // winston.log('info', 'onSceneEvent');
  // winston.log('info', nodeid);
  // winston.log('info', sceneid);
}

function onValueAdded(nodeid, commandclass, value){
  // winston.log('info', 'onValueAdded');
  // winston.log('info', nodeid);
  // winston.log('info', commandclass);
  // winston.log('info', value);
  if (!nodes[nodeid]['classes'][commandclass]) {
    nodes[nodeid]['classes'][commandclass] = {};
  }
  nodes[nodeid]['classes'][commandclass][value.index] = value;
}

function onValueChanged(nodeid, commandclass, value){
  // winston.log('info', 'onValueChanged');
  if (nodes[nodeid]['ready']) {

    if (nodeid !== 3 && nodeid !== 5) {
      winston.log('info', 'node%d: changed: %d:%s:%s->%s', nodeid, commandclass,
        value['label'],
        nodes[nodeid]['classes'][commandclass][value.index]['value'],
        value['value']);
    }
  }
  nodes[nodeid]['classes'][commandclass][value.index] = value;

  sendMessage(nodeid, commandclass, value);
}

function onValueRefreshed(nodeid, commandclass, value){
  if (nodes[nodeid]['ready']) {
    if (nodeid !== 3 && nodeid !== 5) {
      winston.log('info', 'node%d: changed: %d:%s:%s->%s', nodeid, commandclass,
        value['label'],
        nodes[nodeid]['classes'][commandclass][value.index]['value'],
        value['value']);
    }
    sendMessage(nodeid, commandclass, value);
  }
}

function onValueRemoved(nodeid, commandclass, instance, index){
  // winston.log('info', 'onValueRemoved');
  // winston.log('info', nodeid);
  // winston.log('info', commandclass);
  // winston.log('info', instance);
  // winston.log('info', index);
  if (nodes[nodeid]['classes'][commandclass] && nodes[nodeid]['classes'][commandclass][index]) {
    delete nodes[nodeid]['classes'][commandclass][index];
  }
}

function onControllerCommand(nodeid, ctrlState, ctrlError, helpmsg){
  winston.log('info', 'onControllerCommand');
  winston.log('info', nodeid);
  winston.log('info', ctrlState);
  winston.log('info', ctrlError);
  winston.log('info', helpmsg);
}

function onNotification(nodeid, notif) {
  // switch (notif) {
  //   case 0:
  //     winston.log('info', 'node%d: message complete', nodeid);
  //     break;
  //   case 1:
  //     winston.log('info', 'node%d: timeout', nodeid);
  //     break;
  //   case 2:
  //     winston.log('info', 'node%d: nop', nodeid);
  //     break;
  //   case 3:
  //     winston.log('info', 'node%d: node awake', nodeid);
  //     break;
  //   case 4:
  //     winston.log('info', 'node%d: node sleep', nodeid);
  //     break;
  //   case 5:
  //     winston.log('info', 'node%d: node dead', nodeid);
  //     break;
  //   case 6:
  //     winston.log('info', 'node%d: node alive', nodeid);
  //     break;
  // }
}

zwave.connect('/dev/ttyUSB0');

process.on('SIGINT', function() {
  winston.log('info', 'disconnecting...');
  zwave.disconnect();
  process.exit();
});
