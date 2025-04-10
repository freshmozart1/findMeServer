import { WebSocketServer } from "ws";

const server = new WebSocketServer({ port: 8080 });
const rooms = {};
let nextConnectionId = 0;
let activeConnectionsCount = 0;
console.log("WebSocket server is running on ws://localhost:8080");
server.on("connection", (ws) => {
    const connectionId = nextConnectionId.valueOf();
    ws.send(`${connectionId}`);
    nextConnectionId++;
    activeConnectionsCount++;

    ws.on('message', (data) => {
        try {
            const message = data.toString();
            if (message === 'new' && !rooms[connectionId]) {
                rooms[connectionId] = new Set();
                rooms[connectionId].add(ws);
                ws.send(JSON.stringify({ connectionId }));
            } else if (message === 'new' && rooms[connectionId]) throw new Error("Room already exists");
            else {
                const { connectionId: roomId, lattitude, longitude } = JSON.parse(message);
                if (!lattitude || !longitude) throw new Error("No GPS coordinates provided");
                const room = rooms[roomId];
                if (!room) throw new Error("Room not found");
                if (!room.has(ws)) room.add(ws);
                for (const client of room) client !== ws && client.send(JSON.stringify({ connectionId: roomId, lattitude, longitude }));
            }
        } catch (error) {
            ws.send(error.message);
        }
    });

    ws.on("close", () => {
        activeConnectionsCount--;
        if (activeConnectionsCount === 0) nextConnectionId = 0;
    });
});