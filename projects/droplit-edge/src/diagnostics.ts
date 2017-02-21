import * as debug from 'debug';
import * as router from './router';
import * as WebSocket from 'ws';

import net = require('net');
import readline = require('readline');

const log = debug('droplit:diagnostics');
const settings = require('../localsettings.json');

let port = 8888;
const sockets: net.Socket[] = [];
const dxData = {
    connected: <Date>null,
    lastHeartbeat: <Date>null,
    lastHeartbeatAttempt: <Date>null,
    lastMessage: <Date>null
};

if (settings.diagnostics && settings.diagnostics.port)
    port = settings.diagnostics.port;

const server = net.createServer(connection);
server.listen(port, () => log(`Diagnostics port ${port}`));

router.transport.on('attemptHB', () => dxData.lastHeartbeatAttempt = new Date());
router.transport.on('connected', () => dxData.connected = new Date());
router.transport.on('hb', () => dxData.lastHeartbeat = new Date());
router.transport.on('message', () => dxData.lastMessage = new Date());

function connection(socket: net.Socket) {
    sockets.push(socket);

    log('connected');

    socket.setEncoding('utf8');

    const rl = readline.createInterface(socket, socket);
    socket.write('Edge Diagnostics console\n\r');

    const commands: any = {
        exit: () =>
            socket.end('Goodbye!\n\r'),
        help: () =>
            socket.write(`  ${Object.keys(commands).join(', ')}\n\r`),
        local: () =>
            socket.write(`  ${JSON.stringify(settings)}\n\r`),
        message: () => {
            socket.write('  send message...\n\r');
            const data = {
                edgeId: router.macAddress,
                time: new Date()
            };
            router.transport.sendRequest('diagnostics', data, (res, err) => {
                if (err)
                    return socket.write(  `error: ${JSON.stringify(err)}\n\r`);
                socket.write(`  response: ${JSON.stringify(res)}\n\r`);
            });
        },
        plugins: () =>
            socket.write(`  ${(Array as any).from(router.plugins.keys()).join(',\n\r  ')}\n\r`),
        reset: () => {
            throw new Error('This crash is intentional');
        },
        socket: () => {
            const readyState = router.transport.getReadyState();
            const state = (readyState === undefined) ? 'undefined' :
                          (readyState === WebSocket.CLOSED) ? 'closed' :
                          (readyState === WebSocket.CLOSING) ? 'closing' :
                          (readyState === WebSocket.CONNECTING) ? 'connecting' :
                          (readyState === WebSocket.OPEN) ? 'open' :
                          'unknown';
            socket.write(`  current time:           ${new Date().toISOString()}\n\r`);
            socket.write(`  last connected at:      ${dxData.connected ? dxData.connected.toISOString() : null}\n\r`);
            socket.write(`  last heartbeat attempt: ${dxData.lastHeartbeatAttempt ? dxData.lastHeartbeatAttempt.toISOString() : null}\n\r`);
            socket.write(`  last heartbeat:         ${dxData.lastHeartbeat ? dxData.lastHeartbeat.toISOString() : null}\n\r`);
            socket.write(`  last message:           ${dxData.lastMessage ? dxData.lastMessage.toISOString() : null}\n\r`);
            socket.write(`  state:                  ${state}\n\r`);
        }
    };

    rl.on('line', line => {
        if (commands[line])
            commands[line]();
        else
            socket.write(`Unknown command: ${line}\n\r`);
    });

    socket.on('end', () => {
        const i = sockets.indexOf(socket);
        if (i !== -1) {
            sockets.splice(i, 1);
            log('disconnected');
        }
    });
}