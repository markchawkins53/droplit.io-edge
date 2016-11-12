import { EventEmitter } from 'events';
import * as DP from 'droplit-plugin';
import { DeviceMessageResponse } from './types/types';
const debug = require('debug')('droplit:plugin');
const pluginMap: { [name: string]: Controller } = {};

export function instance(pluginName: string): Controller {
    try {
        return pluginMap[pluginName] = pluginMap[pluginName] || new Controller(pluginName);
    } catch (error) {
        // plugin failed to load
        console.log('error', error);
    }
    return undefined;
}

// Derived from router types
export interface InfoEvent {
    message: string;
    timestamp: Date;
    level: ErrorLevel;
}
export interface ErrorEvent {
    name: string;
    message: string;
    stack: string;
    pluginName: string;
    timestamp: Date;
    level: ErrorLevel;
}

export enum ErrorLevel {
    info,
    warning,
    error,
    critical
}

/**
 * This class mostly just wraps the DroplitPlugin class to create a layer of abstraction
 * that allows us to later implement plugins as a separate process or in a sandbox
 * or accomodate for changes to the plugin design in the future
 */

export class Controller extends EventEmitter {
    private pluginInstance: DP.DroplitPlugin;

    constructor(pluginName: string, settings?: any) {
        super();
        this.pluginInstance = this.loadPlugin(pluginName, settings);
        this.initPlugin();
    }

    private loadPlugin(pluginName: string, settings?: any): DP.DroplitPlugin {
        const p = require(pluginName);
        return new p(settings);
    }

    private initPlugin() {
        this.pluginInstance.on('device info', this.deviceInfoHandler.bind(this));
        this.pluginInstance.on('device update', this.deviceUpdateHandler.bind(this));
        this.pluginInstance.on('discover complete', this.discoverCompleteHandler.bind(this));
        this.pluginInstance.on('property changed', this.propertiesChangedHandler.bind(this));
        this.pluginInstance.on('event raised', this.eventsHandler.bind(this));
        this.pluginInstance.on('log info', this.logInfoHandler.bind(this));
        this.pluginInstance.on('log error', this.logErrorHandler.bind(this));
        // this.pluginInstance.on('log info many', this.logInfoHandler.bind(this));
        // this.pluginInstance.on('log error many', this.logErrorHandler.bind(this));
    }

    // event handlers

    private deviceInfoHandler(deviceInfo: DP.DeviceInfo, callback?: (deviceInfo: DP.DeviceInfo) => {}) {
        this.emit('device info', deviceInfo, callback);
    }

    private deviceUpdateHandler(deviceInfo: DP.DeviceInfo) {
        this.emit('device update', deviceInfo);
    }

    private discoverCompleteHandler() {
        // this.emit('discover complete');
    }

    private propertiesChangedHandler(properties: DP.DeviceServiceMember[]) {
        this.emit('property changed', properties);
    }

    private eventsHandler(events: DP.DeviceServiceMember[]) {
        this.emit('event raised', events);
    }

    private logInfoHandler(...args: any[]) {
        this.emit('log info', args.map(this.infoFilter));
    }

    private logErrorHandler(...args: any[]) {
        this.emit('log error', args.map(this.errorFilter));
    }

    // management

    public discover(): void {
        if (this.pluginInstance.discover)
            this.pluginInstance.discover();
    }

    public connect(localId: string): void {
        if (this.pluginInstance.connect)
            this.pluginInstance.connect(localId);
    }

    public disconnect(localId: string): void {
        if (this.pluginInstance.disconnect)
            this.pluginInstance.disconnect(localId);
    }

    public dropDevice(localId: string): void {
        if (this.pluginInstance.dropDevice)
            this.pluginInstance.dropDevice(localId);
    }

    // services

    public callMethods(methods: DP.DeviceServiceMember[]): boolean[] {
        return this.pluginInstance.callMethods(methods);
    }

    public getProperties(properties: DP.DeviceServiceMember[], callback: (values: DP.DeviceServiceMember[]) => void): boolean[] {
        return this.pluginInstance.getProperties(properties, callback);
    }

    public requestMethods(methods: DP.DeviceServiceMember[], callback: (values: DP.DeviceServiceMember[]) => void): boolean[] {
        return this.pluginInstance.requestMethods(methods, callback);
    }

    public setProperties(properties: DP.DeviceServiceMember[]): boolean[] {
        return this.pluginInstance.setProperties(properties);
    }

    public deviceMessage(localId: string, data: any, callback?: (response: any) => void): DeviceMessageResponse {
        return this.pluginInstance.deviceMessage(localId, data, callback);
    }

    private errorFilter(data: any): ErrorEvent {
        let error: ErrorEvent;

        // most likely we will see an error string
        if (typeof data === 'string') {
            error.name = 'Error';
            error.message = data;
            error.stack = undefined;
        }

        else if (data instanceof Error) {
            error.name = data.name;
            error.message = data.message;
            error.stack = data.stack;
        }

        // should we try to parse this the best we can?
        // there would be some known properties that we can
        // look for to accomodate a new error..

        // As typeof returns 'object' if an value is null, we must first
        // check to make sure the value is not null
        if (data !== null && typeof data === 'object') {
            ['name', 'message', 'stack', 'timestamp', 'level'].forEach(prop => {
                if (data[prop]) {
                    // if we know some timestamp
                    if (prop === 'timestamp') {
                        if (data[prop] instanceof Date) {  /* then add to error event */ }
                        else if (typeof (data as any)[prop] === 'string') { /* parse as date */ }
                        else { /* do nothing */ }
                    }
                    // if we know some level
                    else if (prop === 'level') {
                        switch (data[prop]) {
                            case ErrorLevel.error || 'error': return; // assign as ErrorLevel.error;
                            case ErrorLevel.warning || 'warning': return; // assign as ErrorLevel.warning;
                            case ErrorLevel.critical || 'critical': return; // assign as ErrorLevel.critical;
                            default: return; // do nothing
                        }
                    }
                    // otherwise assume the prop is safe and assign to error
                    else (error as any)[prop] = data[prop];
                }
            });
        }

        // fill in missing properties
        error.level = error.level || ErrorLevel.error;
        error.timestamp = error.timestamp || new Date();
        return error;
    }

    private infoFilter(data: any): InfoEvent {
        let info: InfoEvent;



        // should we try to parse this the best we can?
        // there would be some known properties that we can
        // look for to accomodate a new error..

        // As typeof returns 'object' if an value is null, we must first
        // check to make sure the value is not null
        if (data !== null && typeof data === 'object') {
            ['message', 'timestamp', 'level'].forEach(prop => {
                if (data['prop']) {
                    // if we know some timestamp
                    if (prop === 'timestamp') {
                        if (data[prop] instanceof Date) {  /* then add to error event */ }
                        else if (typeof data[prop] === 'string') { /* parse as date */ }
                        else { /* do nothing */ }
                    }
                    // if we know some level
                    else if (prop === 'level') {
                        switch (data[prop]) {
                            case ErrorLevel.error || 'error': return; // assign as ErrorLevel.error;
                            case ErrorLevel.warning || 'warning': return; // assign as ErrorLevel.warning;
                            case ErrorLevel.critical || 'critical': return; // assign as ErrorLevel.critical;
                            default: return; // do nothing
                        }
                    }
                    // otherwise assume the prop is safe and assign to error
                    else (info as any)[prop] = data[prop];
                }
            });
        }

        // most likely we will see a string of information
        else {
            // if the data is not an object, then the data is either a string
            // or something we cannot normalize. Therefore we simply assign the
            // information in the same manner than you would to pass string data.
            info.message = data;
            info.timestamp = new Date();
            info.level = ErrorLevel.info;
        }

        // fill in missing properties
        info.level = info.level || ErrorLevel.info;
        info.timestamp = info.timestamp || new Date();
        return info;
    }
}