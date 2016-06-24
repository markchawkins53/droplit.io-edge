'use strict';

const dgram  = require('dgram');
const droplit = require('droplit-plugin');
const EventEmitter = require('events').EventEmitter;
const os = require('os');
const process = require('process');
const lifxPacket = require('./Packet');

const MulticastPort = 56700;
const StepSize = parseInt(0xFFFF / 10);
const TempLower = 2500;
const TempUpper = 9000;

lifxPacket.setDebug(false);

let ips = [];

class LifxPlugin extends droplit.DroplitPlugin {
    constructor() {
        super();

        this.bulbs = new Map();
        this.gateways = new Map();
        
        // Start at 1; 0 is for non-sequenced packets
        this.sequencer = 1;
        this.sequence = {};
        
        getIps();

        // Use local IP as source to identify LIFX packets for this server
        this.source = new Buffer(ips[0].split('.'));
        
        // Packet types that should be sequenced
        this.packetMap = {
            0x65: { state: 'lightState' },                      // getLight
            0x66: { get: 'getLight', state: 'lightState' },     // setColor
            0x74: { state: 'statePower' },                      // getLightPower
            0x75: { get: 'getLightPower', state: 'statePower' } // setLightPower
        };
        
        this.udpClient = dgram.createSocket('udp4');
        this.udpClient.on('error', udpError.bind(this));
        this.udpClient.on('message', udpMessage.bind(this));
        
        this.services = {
            BinarySwitch: {
                get_switch: this.getSwitch,
                set_switch: this.setSwitch,
                switchOff: this.switchOff,
                switchOn: this.switchOn
            },
            DimmableSwitch: {
                get_brightness: this.getDSBrightness,
                set_brightness: this.setDSBrightness,
                stepDown: this.stepDown,
                stepUp: this.stepUp
            },
            MulticolorLight: {
                get_brightness: this.getMclBrightness,
                get_hue: this.getHue,
                get_saturation: this.getSaturation,
                get_temperature: this.getTemperature,
                get_tempLowerLimit: this.getTempLowerLimit,
                get_tempUpperLimit: this.getTempUpperLimit,
                set_brightness: this.setMclBrightness,
                set_hue: this.setHue,
                set_saturation: this.setSaturation,
                set_temperature: this.setTemperature
            }
        }
        
        // Listen to UDP multicast on the network for the designated LIFX port
        this.udpClient.bind(MulticastPort, '0.0.0.0', () => 
            this.udpClient.setBroadcast(true));
        
        // Called when a bulb's state and version are known
        function bulbReady(bulb) {
            this.onDeviceInfo(bulb.discoverObject());
            let output = bulb.outputState();
            let propChanges = [];
            
            propChanges.push(bulb.propertyObject('BinarySwitch', 'switch', output.on));
            propChanges.push(bulb.propertyObject('DimmableSwitch', 'brightness', output.ds_brightness));
            if (bulb.services.some(s => s === 'MulticolorLight')) {
                propChanges.push(bulb.propertyObject('MulticolorLight', 'brightness', output.mcl_brightness));
                propChanges.push(bulb.propertyObject('MulticolorLight', 'hue', output.hue));
                propChanges.push(bulb.propertyObject('MulticolorLight', 'saturation', output.sat));
                propChanges.push(bulb.propertyObject('MulticolorLight', 'temperature', output.temp));
                propChanges.push(bulb.propertyObject('MulticolorLight', 'tempLowerLimit', output.tempLowerLimit));
                propChanges.push(bulb.propertyObject('MulticolorLight', 'tempUpperLimit', output.tempUpperLimit));
            }
            
            if (propChanges.length > 0)
                this.onPropertiesChanged(propChanges);
        }
        
        // Called when a lightState packet is retrieved, any differences to known state are pushed out as property changes
        function bulbStateChange(bulb, newState) {
            let state = bulb.state;
            let propChanges = [];
            let output = bulb.outputState(newState);
            
            if (!state.hasOwnProperty('power') || state.power !== newState.power)
                propChanges.push(bulb.propertyObject('BinarySwitch', 'switch', output.on));
                
            if (!state.hasOwnProperty('brightness') || state.brightness !== newState.brightness) {
                propChanges.push(bulb.propertyObject('DimmableSwitch', 'brightness', output.ds_brightness));
                if (bulb.services.some(s => s === 'MulticolorLight'))
                    propChanges.push(bulb.propertyObject('MulticolorLight', 'brightness', output.mcl_brightness));
            }
            
            if (!state.hasOwnProperty('hue') || state.hue !== newState.hue)
                propChanges.push(bulb.propertyObject('MulticolorLight', 'hue', output.hue));
                
            if (!state.hasOwnProperty('saturation') || state.saturation !== newState.saturation)
                propChanges.push(bulb.propertyObject('MulticolorLight', 'saturation', output.sat));
                
            if (!state.hasOwnProperty('kelvin') || state.kelvin !== newState.kelvin)
                propChanges.push(bulb.propertyObject('MulticolorLight', 'temperature', output.temp));
            
            if (propChanges.length > 0)
                this.onPropertiesChanged(propChanges);
        }
        
        // Find IP addresses for this machine
        function getIps() {
            if (ips.length > 0)
                return ips;
                
            let ipSet = new Set();
            let interfaces = os.networkInterfaces();
            Object.keys(interfaces).forEach(name => {
                if (/(loopback|vmware|internal)/gi.test(name))
                    return;
                interfaces[name].forEach(info => {
                    if (!info.internal && info.family === 'IPv4')
                        ipSet.add(info.address);
                });
            });
                    
            ips = Array.from(ipSet);
            return ips;
        }
        
        // Processes LIFX packets
        function processPacket(packet, rinfo) {
            // Packet is in response to one we sent
            let sourceMatch = (Buffer.compare(packet.preamble.source, this.source) === 0);
            let address = packet.preamble.target.toString('hex');
            
            switch (packet.packetTypeShortName) {
                case 'stateService': {
                    if (packet.payload.service === 1 && packet.payload.port > 0) {
                        if (!this.gateways.has(rinfo.address)) {
                            let gateway = {
                                ip: rinfo.address,
                                port: packet.payload.port,
                                site: packet.preamble.site,
                                service: packet.payload.service,
                                protocol: packet.preamble.protocol,
                                address: packet.preamble.target.toString('hex')
                            };
                            this.gateways.set(rinfo.address, gateway);
                            
                            if (sourceMatch && this.sequence[packet.preamble.sequence])
                                this.send(lifxPacket.getVersion(), packet.preamble.target);
                        }
                    }
                    break;
                }
                case 'stateVersion': {
                    if (!this.bulbs.has(address)) {
                        this.bulbs.set(address, new LifxBulb(address));
                        this.bulbs.get(address).on('ready', bulbReady.bind(this));
                    }
                    
                    let bulb = this.bulbs.get(address); 
                    bulb.version = packet.payload;
                    
                    if (bulb.state === undefined)
                        this.send(lifxPacket.getLight(), packet.preamble.target);
                    
                    break;
                }
                case 'lightState': {
                    if (!this.bulbs.has(address)) {
                        this.bulbs.set(address, new LifxBulb(address));
                        this.bulbs.get(address).on('ready', bulbReady.bind(this));
                    }
                    
                    let bulb = this.bulbs.get(address); 
                    let state = {
                        hue: packet.payload.hue,
                        saturation: packet.payload.saturation,
                        brightness: packet.payload.brightness,
                        kelvin: packet.payload.kelvin,
                        power: packet.payload.power
                    };
                    
                    if (sourceMatch && this.sequence[packet.preamble.sequence]) {
                        let seqData = this.sequence[packet.preamble.sequence];

                        // This packet is in response to an explicit get request
                        if (seqData.callback && seqData.state)
                            seqData.callback(bulb.outputState(state)[seqData.state]);
                            
                        delete this.sequence[packet.preamble.sequence];
                    }
                    
                    if (bulb.ready)
                        bulbStateChange.bind(this)(bulb, state);
                        
                    bulb.state = state;    
                    
                    if (bulb.version === undefined)
                        this.send(lifxPacket.getVersion(), packet.preamble.target);
                    
                    break;
                }
                case 'statePower': {
                    if (!this.bulbs.has(address))
                        break;
                        
                    let bulb = this.bulbs.get(address);
                    
                    // This packet is in response to an explicit get request
                    if (sourceMatch && this.sequence[packet.preamble.sequence]) {
                        let seqData = this.sequence[packet.preamble.sequence];
                        if (seqData.callback)
                            seqData.callback(bulb.outputState({ power: packet.payload.level }).on);

                        delete this.sequence[packet.preamble.sequence];
                    }
                    
                    if (bulb.ready && (packet.payload.level !== bulb.state.power))
                        this.onPropertiesChanged([ bulb.propertyObject('BinarySwitch', 'switch', bulb.outputState({ power: packet.payload.level }).on) ]);
                    
                    let state = bulb.state;
                    state.power = packet.payload.level;    
                    bulb.state = state;
                        
                    break;
                }
                case 'acknowledgement': {
                    // Call the get for a set we explicitly asked for an acknowledgement on
                    if (sourceMatch && this.sequence[packet.preamble.sequence]) {
                        let data = this.sequence[packet.preamble.sequence].map;
                        setTimeout(() => this.send(lifxPacket[data.get](), packet.preamble.target), 250);
                        delete this.sequence[packet.preamble.sequence];
                    }
                    break;
                }
            }
        }
        
        function udpError(err) { }
        
        // Handle udp messages
        function udpMessage(msg, rinfo) {
            if (ips.some(ip => ip === rinfo.address))
                return;

            let packet = lifxPacket.fromBytes(msg);
            if (packet)
                processPacket.bind(this)(packet, rinfo);
        }
    }
    
    discover() {
        let packet = lifxPacket.getService({
            source: this.source,
            sequence: this.sequencer++
        });
        // Discovery is done through UDP broadcast to port 56700
        this.udpClient.send(packet, 0, packet.length, MulticastPort, '255.255.255.255', (err, bytes) => { });
    }
    
    dropDevice(localId) {
        let bulb = this.bulbs.get(localId);
        if (!bulb)
            return false;
        
        bulb.removeAllListeners('ready');
        
        let gateway;
        for (gateway of this.gateways.values()) {
            if (gateway.address === bulb.address.toString('hex'))
                break;
        }
        if (gateway)
            this.gateways.delete(gateway.ip);
            
        this.bulbs.delete(bulb.address);
    }
    
    send(packet, address, callback, state) {
        // Ensure address is in buffer form
        if (typeof address === 'string')
            address = new Buffer(address, 'hex');
        
        // Add source to all outbound packets
        this.source.copy(packet, 4);
        
        // Add address to outbound packets, if specified
        if (address)
            address.copy(packet, 8);
        
        // Add sequence to all outbound packets
        let sequenceId = this.sequencer++;
        if (sequenceId === 0xFF)
            this.sequencer = 1;             
        packet[23] = sequenceId;
        
        // If packet type is in map, we want to do something special with the response that has the same sequence id
        let type = packet.readUInt16LE(32);
        if (this.packetMap[type])
            this.sequence[sequenceId] = {
                callback,
                map: this.packetMap[type],
                state
            };
            
        for (let gateway of this.gateways.values()) {
            if (gateway.address === address.toString('hex')) {
                gateway.site.copy(packet, 16);
                this.udpClient.send(packet, 0, packet.length, gateway.port, gateway.ip, (err, bytes) => { });
            }
        }
    }
    
    setColor(address, hue, saturation, brightness, temperature) {
        let packet = lifxPacket.setColor({
            reserved: 0,
            hue,
            saturation,
            brightness,
            kelvin: temperature,
            duration: 0
        });
        this.send(packet, address);
    }
    
    // BinarySwitch Implementation
    getSwitch(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb)
            this.send(lifxPacket.getLightPower(), bulb.address, callback);
    }
    
    setSwitch(localId, value) {
        if (value === 'off')
            this.switchOff(localId);
        else if (value === 'on')
            this.switchOn(localId);
        return true;
    }
    
    switchOff(localId) {
        let bulb = this.bulbs.get(localId);
        if (bulb)
            this.send(lifxPacket.setLightPower({ level: 0, duration: 0 }), bulb.address);
    }
    
    switchOn(localId) {
        let bulb = this.bulbs.get(localId);
        if (bulb)
            this.send(lifxPacket.setLightPower({ level: 0xFFFF }), bulb.address);
    }
    
    // DimmableSwitch Implementation
    getDSBrightness(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            this.send(lifxPacket.getLight(), bulb.address, callback, 'ds_brightness');
            return;
        }
        callback();
    }
    
    setDSBrightness(localId, value) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            let state = bulb.state;
            let brightness = normalize(value, 0, 100, 0xFFFF);
            this.setColor(bulb.address, state.hue, state.saturation, brightness, state.kelvin);
        }
        return true;
    }
    
    stepDown(localId) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            let state = bulb.state;
            let brightness = normalize(Math.max(state.brightness - StepSize, 0), 0, 0xFFFF, 100);
            this.setDSBrightness(localId, brightness);
        }
    }
    
    stepUp(localId) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            let state = bulb.state;
            let brightness = normalize(Math.min(state.brightness + StepSize, 0xFFFF), 0, 0xFFFF, 100);
            this.setDSBrightness(localId, brightness);
        }
    }
    
    // MulticolorLight Implementation
    getMclBrightness(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            this.send(lifxPacket.getLight(), bulb.address, callback, 'mcl_brightness');
            return;
        }
        callback();
    }
    
    getHue(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            this.send(lifxPacket.getLight(), bulb.address, callback, 'hue');
            return;
        }
        callback();
    }
    
    getSaturation(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            this.send(lifxPacket.getLight(), bulb.address, callback, 'sat');
            return;
        }
        callback();
    }
    
    getTemperature(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            this.send(lifxPacket.getLight(), bulb.address, callback, 'temp');
            return;
        }
        callback();
    }
    
    getTempLowerLimit(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            callback(TempLower);
            return;
        }
        callback();
    }
    
    getTempUpperLimit(localId, callback) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            callback(TempLower);
            return;
        }
        callback();
    }
    
    setHue(localId, value) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            let state = bulb.state;
            this.setColor(bulb.address, value, state.saturation, state.brightness, state.kelvin);
        }
        return true;
    }
    
    setMclBrightness(localId, value) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            let state = bulb.state;
            this.setColor(bulb.address, state.hue, state.saturation, value, state.kelvin);
        }
        return true;
    }
    
    setSaturation(localId, value) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            let state = bulb.state;
            this.setColor(bulb.address, state.hue, value, state.brightness, state.kelvin);
        }
        return true;
    }
    
    setTemperature(localId, value) {
        let bulb = this.bulbs.get(localId);
        if (bulb) {
            let state = bulb.state;
            let brightness = normalize(value, 0, 100, 0xFFFF);
            this.setColor(bulb.address, state.hue, state.saturation, state.brightness, value);
        }
        return true;
    }
}

// Encapsulate private fields via symbols
const _ready = Symbol('ready');
const _state = Symbol('state');
const _version = Symbol('version');

class LifxBulb extends EventEmitter {
    constructor(address) {
        super();
        
        this.address = address;
        this.deviceMeta = { name: '' };
        this.product = {};
        this.services = [];
        this.promotedMembers = {
            switch: 'BinarySwitch.switch',
            brightness: 'DimmableSwitch.brightness'
        };
        
        this[_ready];
        this[_state];
        this[_version];
    }
    
    discoverObject() {
        return {
            localId: this.address,
            address: this.address,
            product: this.product,
            services: this.services,
            promotedMembers: this.promotedMembers
        };
    }
    
    outputState(state) {
        state = state || this.state;
        return {
            ds_brightness: normalize(state.brightness, 0, 0xFFFF), 
            hue: state.hue,
            mcl_brightness: state.brightness,
            on: state.power > 0 ? 'on' : 'off',
            sat: state.saturation,
            temp: state.kelvin,
            tempLowerLimit: TempLower,
            tempUpperLimit: TempUpper
        };
    }
    
    propertyObject(service, member, value) {
        return {
            localId: this.address,
            service,
            member,
            value
        };
    }
    
    get ready() { return this[_ready]; }
    
    get state() { return this[_state]; }
    set state(state) {
        this[_state] = state;
        
        if (this[_version] && !this[_ready]) {
            this[_ready] = true;
            this.emit('ready', this);
        }
    }
    
    get version() { return this[_version]; }
    set version(version) { 
        this[_version] = version;
        let isWhite = (version.product === 167772160);
        this.product.modelName = isWhite ? 'LIFX White' : 'LIFX';
        this.services = isWhite ?
            ['BinarySwitch', 'DimmableSwitch'] :
            ['BinarySwitch', 'DimmableSwitch', 'MulticolorLight'];
        
        if (this[_state] && !this[_ready]) {
            this[_ready] = true;
            this.emit('ready', this);
        }
    }
}

function normalize(value, min, max, mult) {
    mult = mult || 100;
    return parseInt(((value - min) / (max - min)) * mult);
}

module.exports = LifxPlugin;