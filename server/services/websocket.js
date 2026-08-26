const WebSocket = require('ws');

let wss = null;

function initWebSocket(server) {
    wss = new WebSocket.Server({ server, path: '/ws/progress' });

    wss.on('connection', (ws) => {
        console.log('[WebSocket] Client connected for real-time progress');

        ws.send(JSON.stringify({
            type: 'connected',
            message: 'Real-time download progress connected'
        }));

        ws.on('close', () => {
            console.log('[WebSocket] Client disconnected');
        });
    });

    console.log('[WebSocket] Server initialized on path /ws/progress');
    return wss;
}

function broadcastProgress(data) {
    if (!wss) return;

    const payload = JSON.stringify({
        type: 'progress_update',
        timestamp: new Date().toISOString(),
        ...data
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

module.exports = {
    initWebSocket,
    broadcastProgress
};
