import * as droplit from 'droplit-plugin';

console.log('example');

export class ExamplePlugin extends droplit.DroplitPlugin {

    services: any;

    constructor() {
        super();
        // console.log('example construct');
        this.services = {
            BinarySwitch: {
                get_switch: this.BinarySwitch_get_switch,
                set_switch: this.BinarySwitch_set_switch,
            },
            Connectivity: {
                get_status: this.getStatus,
            }
        };
    }

    // virtual device states
    private devices: any = {
        '1': {
            'BinarySwitch.switch': 'off',
            'Connectivity.status': 'online'
        },
        '2': {
            'BinarySwitch.switch': 'off',
            'Connectivity.status': 'online'
        }
    };

    // virtual device tracking
    private deviceConnected: { [localId: string]: boolean } = {};

    /**
     * Example plugin will produce two devices when told to discover
     */

    public discover() {
        setImmediate(() => { // simulate async
            this.onDeviceInfo({
                localId: '1',
                address: 'device.1',
                localName: 'first device',
                localData: { location: 'main facility' },
                services: ['BinarySwitch', 'Connectivity'],
                promotedMembers: {
                    'switch': 'BinarySwitch.switch',
                    'status': 'Connectivity.status'
                }
            });
            this.onDeviceInfo({
                localId: '2',
                address: 'device.2',
                localName: 'second device',
                localData: { location: 'main facility' },
                services: ['BinarySwitch', 'Connectivity'],
                promotedMembers: {
                    'switch': 'BinarySwitch.switch',
                    'status': 'Connectivity.status'
                }
            });
            this.onDiscoverComplete();
        });
    }

    public connect(localId: string): boolean {
        // track state changes on this device
        this.deviceConnected[localId] = true;
        return true;
    }

    public disconnect(localId: string): boolean {
        // stop tracking state changes on this device
        this.deviceConnected[localId] = false;
        return true;
    }

    public dropDevice(localId: string): boolean {
        this.disconnect(localId);
        return true;
    }

    public getStatus(localId: string, callback: (result: any) => void) {
        callback(this.devices[localId]['Connectivity.status']);
    }

    protected BinarySwitch_get_switch(localId: string, index: string, callback: (value: any) => void): boolean {
        if (index === undefined) {
            setImmediate(() => { // simulate async
                // send last set value
                callback(this.devices[localId]['BinarySwitch.switch']);
            });
            return true;
        }
        return false;
    }

    protected BinarySwitch_set_switch(localId: string, index: string, value: any): boolean {
        if (index === undefined) {
            setImmediate(() => { // simulate async
                // simulate setting device property
                this.devices[localId]['BinarySwitch.switch'] = value;
                // check if we're supposed to be tracking the device state
                if (this.deviceConnected[localId]) {
                    /**
                     * we have a connection to the device,
                     * so we would get a notification that the state changed
                     * indicate the property changed
                     */
                    this.onPropertiesChanged([{
                        localId: localId,
                        index: index,
                        member: 'switch',
                        service: 'BinarySwitch',
                        value: value
                    }]);
                } else {
                    /**
                     * send command to device, but state change doesn't
                     * report back because the state is not being tracked
                     */
                }
            });
            return true;
        }
        return false;
    }
}