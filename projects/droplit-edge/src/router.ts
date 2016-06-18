import * as cache from './cache';
import Transport from './transport';
import * as plugin from './plugin';
import * as DP from 'droplit-plugin';
import * as debug from 'debug';
import {DeviceInfo} from './types/DeviceInfo';

let log = debug('droplit:router');

export interface DeviceCommand {
    deviceId: string;
    localId?: string;
    service: string;
    index: string;
    member: string;
    value?: any;
}

// Amount of time (ms) to wait before turning on auto discover
const AutoDiscoverDelay = 2 * 60 * 1000;
// Amount of time (ms) between discovery attempts
const AutoDiscoverCadence = 60000;

let settings = require('../settings.json');
let autodiscoverTimer: number;
let transport = new Transport();

declare var Map: any; // Work-around typescript not knowing Map when it exists for the JS runtime
let plugins = new Map();

if (settings.debug.generateHeapDump) {
    const heapdump = require('heapdump');
    const heapInterval = 30 * 60 * 1000;
    
    writeSnapshot.bind(this)();
    setInterval(writeSnapshot.bind(this), heapInterval);
    
    function writeSnapshot() {
        heapdump.writeSnapshot(`droplit-${Date.now()}.heapsnapshot`, (err: any, filename: string) => {
            if (err) {
                console.log('error writing heap snapshot:', err);
                return;
            }
            console.log(`wrote heap snaphot: ${filename}`);
        });
    }
}

transport.on('connected', () => {
    loadPlugins();
    discoverAll();
    if (settings.router.autodiscover)
        setTimeout(startAutodiscover.bind(this), AutoDiscoverDelay);
});

transport.on('disconnected', () => { });

transport.on('#discover', (data: any) => { });

transport.on('#drop', (data: any) => {
    if (data)
        dropDevice(data);
});

transport.on('#property set', (data: any, cb: (response: any) => void) => {
    let results: boolean[] = [];
    if (data)
        setProperties(data);
        
    if (cb)
        cb(results);
});

transport.on('#property get', (data: any, cb: (response: any) => void) => {
    if (data)
        getProperties(data);
});

transport.on('#method call', (data: any, cb: (response: any) => void) => {
    if (data)
        callMethods(data);
        
    if (cb)
        cb(true);
});

// transport.on('#plugin message', (data: any, cb: (response: any) => void) => {
    
// });

// transport.on('#plugin setting', (data: any, cb: (response: any) => void) => {
    
// });


export function callMethods(commands: DeviceCommand[]): void {
    let map = groupByPlugin(commands);
    let results: boolean[] = Array.apply(null, Array(commands.length)); // init all values to undefined
    Object.keys(map).forEach(pluginName => {
        // send commands to plugin
        plugin.instance(pluginName).callMethods(map[pluginName]);
    });
}

/**
 * Discovers devices for a single plugin. If not specified, runs discovery for all plugins.
 * 
 * @export
 * @param {string} [pluginName] Plugin to run discovery
 */
export function discover(pluginName?: string) {
    if (pluginName)
        return discoverOne(pluginName);
    discoverAll();
}

export function dropDevice(commands: DeviceCommand[]) {
    let map = groupByPlugin(commands);
    let results: boolean[] = Array.apply(null, Array(commands.length)); // init all values to undefined
    Object.keys(map).forEach(pluginName => {
        map[pluginName].forEach(device => {
            // send commands to plugin
            plugin.instance(pluginName).dropDevice(device.localId);
        });
    });
}

export function getProperties(commands: DeviceCommand[]): boolean[] {
    let map = groupByPlugin(commands);
    let results: boolean[] = Array.apply(null, Array(commands.length)); // init all values to undefined
    Object.keys(map).forEach(pluginName => {
        // send commands to plugin
        let sectionResults = plugin.instance(pluginName).getProperties(map[pluginName], values => {
            console.log('values', values);
        });
    });
    return results;
}

export function setProperties(commands: DeviceCommand[]): boolean[] {
    let map = groupByPlugin(commands);
    let results: boolean[] = Array.apply(null, Array(commands.length)); // init all values to undefined
    Object.keys(map).forEach(pluginName => {
        // send commands to plugin
        let sectionResults = plugin.instance(pluginName).setProperties(map[pluginName]);
        if (sectionResults) {
            // reorganize the results to the original sequence
            sectionResults.forEach((result, index) => {
                let resultIndex = (<any>map[pluginName][index])._sequence;
                results[resultIndex] = result;
            });
        }
    });
    return results;
}

function discoverAll() {
    let timeout = 0;
    plugins.forEach((plugin: any) => {
        setTimeout(plugin => {
            plugin.discover();
        }, timeout, plugin);
        timeout += 2000;
    });
}

function discoverOne(pluginName: string) {
    if (!plugins.has(pluginName))
        return;
    plugins.get(pluginName).discover();
}

function groupByPlugin(commands: DeviceCommand[]): {[pluginName: string]: DP.DeviceServiceMember[]} {
    let map: {[pluginName: string]: DP.DeviceServiceMember[]} = {};
    commands.forEach((command, index) => {
        (<any>command)._sequence = index; // preserve the original sequence number
        let pluginName = getPluginName(command);
        if (pluginName) {
            map[pluginName] = map[pluginName] || [];
            map[pluginName].push(getServiceMember(command));
        }
    });
    return map;
}

function getServiceMember(command: DeviceCommand): DP.DeviceServiceMember {
    let deviceInfo = cache.getDeviceByDeviceId(command.deviceId);
    // HACK: Allows easier testing via wscat
    let localId = command.localId || deviceInfo.localId;
    return {
        localId: localId,
        address: deviceInfo ? deviceInfo.address : null,
        service: command.service,
        index: command.index,
        member: command.member,
        value: command.value
    };
}

function getPluginName(command: DeviceCommand) {
    // HACK: Allows easier testing via wscat
    let local = cache.getDeviceByLocalId(command.localId);
    if (local)
        return local.pluginName;
        
    let device = cache.getDeviceByDeviceId(command.deviceId);
    if (device) 
        return device.pluginName;

    return null;
}

function loadPlugins() {
    log('load plugins');
    // loadPlugin('droplit-plugin-lifx');
    // loadPlugin('droplit-plugin-philips-hue');
    loadPlugin('droplit-plugin-wemo');
    // loadPlugin('droplit-plugin-ts-example');
}

function loadPlugin(pluginName: string) {
    let p = plugin.instance(pluginName);
    if (!p)
        return;
        
    p.on('device info', (deviceInfo: DP.DeviceInfo) => {
        deviceInfo.pluginName = pluginName;
        cache.setDeviceInfo(deviceInfo);
        transport.sendRequest('device info', deviceInfo, (response) => {
            
        });
    });

    p.on('property changed', (properties: DP.DeviceServiceMember[]) => {
        transport.send('property changed', properties, err => {});
    });
    plugins.set(pluginName, p);
}

function startAutodiscover() {
    // Already auto-discovering
    if (autodiscoverTimer)
        return;
        
    // First auto should be immediate
    discoverAll.bind(this)();
    autodiscoverTimer = setInterval(discoverAll.bind(this), AutoDiscoverCadence);
}

let _edgeId: string = undefined;

function getEdgeId(callback: (edgeId: string) => void) {
    if (_edgeId) {
        callback(_edgeId);
    } else {
        let mac = require('getmac');
        mac.getMac((err: Error, macAddress: string) => {
            if (err) throw err;
            _edgeId = macAddress;
            callback(_edgeId);
        });
    }
}

getEdgeId((edgeId) => {
    let localSettings = require('../localsettings.json');
    transport.start(settings.transport, {
        "x-edge-id": edgeId,
        "x-ecosystem-id": localSettings.ecosystemId
    });
});