'use strict';

const droplit = require('droplit-plugin');

class ExamplePlugin extends droplit.DroplitPlugin {

    constructor() {
        super();

        // ensure connectivity ability is live
        this.connectActive = false;
        // virtual device states
        this.devices = {};

        /* eslint-disable camelcase */
        this.services = {
            BinarySwitch: {
                get_switch: this.getSwitch,
                set_switch: this.setSwitch,
                switchOff: this.switchOff,
                switchOn: this.switchOn
            },
            Connectivity: {
                connect: this.connect,
                disconnect: this.disconnect,
                get_status: this.getStatus
            }
        };
        /* es-lint-enable camelcase */
    }

    /**
     * Example plugin will produce two devices when told to discover
     */
    discover() {
        setImmediate(() => { // simulate async
            if (!this.devices[1]) {
                this.devices[1] = { 'BinarySwitch.switch': 'off' };
                this.onDeviceInfo({
                    localId: '1',
                    address: 'device.1',
                    deviceMeta: {
                        customName: 'first device',
                        location: 'main facility'
                    },
                    services: ['BinarySwitch'],
                    promotedMembers: {
                        switch: 'BinarySwitch.switch'
                    }
                });
                this.onPropertiesChanged([{ localId: '1', member: 'switch', service: 'BinarySwitch', value: 'off' }]);
            }

            if (!this.devices[2]) {
                this.devices[2] = { 'BinarySwitch.switch': 'off' };
                this.onDeviceInfo({
                    localId: '2',
                    address: 'device.2',
                    deviceMeta: {
                        customName: 'second device',
                        location: 'main facility'
                    },
                    services: ['BinarySwitch'],
                    promotedMembers: {
                        switch: 'BinarySwitch.switch'
                    }
                });
                this.onPropertiesChanged([{ localId: '2', member: 'switch', service: 'BinarySwitch', value: 'off' }]);
            }

            if (!this.devices[3]) {
                this.devices[3] = [
                    { 'BinarySwitch.switch': 'off' },
                    { 'BinarySwitch.switch': 'off' },
                    { 'BinarySwitch.switch': 'off' }
                ];
                this.onDeviceInfo({
                    localId: '3',
                    address: 'device.3',
                    deviceMeta: { name: 'third device' },
                    location: 'main facility',
                    name: 'device3',
                    services: ['BinarySwitch[0..2]'],
                    promotedMembers: {
                        switch: 'BinarySwitch.switch'
                    }
                });
                this.onPropertiesChanged([{ localId: '3', index: '0', member: 'switch', service: 'BinarySwitch', value: 'off' }]);
                this.onPropertiesChanged([{ localId: '3', index: '1', member: 'switch', service: 'BinarySwitch', value: 'off' }]);
                this.onPropertiesChanged([{ localId: '3', index: '2', member: 'switch', service: 'BinarySwitch', value: 'off' }]);
            }

            this.onDiscoverComplete();
        });
    }

    dropDevice(localId) {
        this.disconnect(localId);
        delete this.devices[localId];
        return true;
    }

    // BinarySwitch Implementation
    getSwitch(localId, callback, index) {
        // device does not exist
        if (!this.devices[localId]) {
            callback(undefined);
            return true;
        }

        // Check if indexed
        if (Array.isArray(this.devices[localId])) {
            if (!this.devices[localId][index])
                return true;

            setImmediate(() => { // simulate async
                // send last set value
                callback(this.devices[localId][index]['BinarySwitch.switch']);
            });
            return true;
        }

        setImmediate(() => { // simulate async
            // send last set value
            callback(this.devices[localId]['BinarySwitch.switch']);
        });
        return true;
    }

    setSwitch(localId, value, index) {
        // device does not exist
        if (!this.devices[localId])
            return true;

        // check if values are valid
        if (value !== 'on' && value !== 'off')
            return true;

        // Check if indexed
        if (Array.isArray(this.devices[localId])) {
            if (!this.devices[localId][index])
                return true;

            // simulate setting device property
            this.devices[localId][index]['BinarySwitch.switch'] = value;

            if (!this.connectActive || this.deviceConnected[localId]) {
                // send state change notification
                setImmediate(() => // simulate async
                    this.onPropertiesChanged([{
                        localId,
                        index,
                        member: 'switch',
                        service: 'BinarySwitch',
                        value
                    }])
                );
            }
            return true;
        }

        // simulate setting device property
        this.devices[localId]['BinarySwitch.switch'] = value;

        // check if we're supposed to be tracking the device state
        if (!this.connectActive || this.deviceConnected[localId]) {
            // send state change notification
            setImmediate(() => // simulate async
                this.onPropertiesChanged([{
                    localId,
                    member: 'switch',
                    service: 'BinarySwitch',
                    value
                }])
            );
        }
        return true;
    }

    switchOff(localId, value, callback, index) {
        return this.setSwitch(localId, 'off', index);
    }

    switchOn(localId, value, callback, index) {
        return this.setSwitch(localId, 'on', index);
    }

    // Connectivity Implementation
    connect(localId) {
        this.connectActive = true;
        // track state changes on this device
        this.deviceConnected[localId] = true;
        return true;
    }

    disconnect(localId) {
        // stop tracking state changes on this device
        this.deviceConnected[localId] = false;
        return true;
    }

    getStatus(localId, callback) {
        callback(this.devices[localId]['Connectivity.status']);
        return true;
    }
}

module.exports = ExamplePlugin;
