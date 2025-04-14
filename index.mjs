import { WebSocketServer } from "ws";
import { initializeApp } from 'firebase-admin/app';
import fs from 'fs';

const server = new WebSocketServer({ port: 8080 });
const rooms = {};
let nextConnectionId = 0;
let activeConnectionsCount = 0;
console.log("WebSocket server is running on ws://localhost:8080");

let app;
try {
    let firebaseConfig;
    if (process.env.NODE_ENV === 'development') {
        firebaseConfig = JSON.parse(fs.readFileSync('./firebase.secret.json', 'utf8'));
    } else {
        firebaseConfig = {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.FIREBASE_PROJECT_ID,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
            appId: process.env.FIREBASE_APP_ID
        }
    }
    app = initializeApp(firebaseConfig);
} catch (error) {
    console.error("Error initializing Firebase Admin SDK:", error);
    process.exit(1);
}

server.on("connection", (ws) => {
    ws.connectionId = nextConnectionId.valueOf();
    ws.isAlive = true;
    nextConnectionId++;
    activeConnectionsCount++;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    ws.on('message', (data) => {
        try {
            const message = data.toString();
            if (message === 'new' && !rooms[ws.connectionId]) {
                rooms[ws.connectionId] = new Set();
                rooms[ws.connectionId].add(ws);
                ws.send(JSON.stringify({ connectionId: ws.connectionId }));
            } else if (message === 'new' && rooms[ws.connectionId]) throw new Error("Room already exists");
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
        if (rooms[ws.connectionId]) {
            rooms[ws.connectionId].delete(ws);
            if (!rooms[ws.connectionId].size) delete rooms[ws.connectionId];
        }
        activeConnectionsCount--;
        if (activeConnectionsCount === 0) nextConnectionId = 0;
    });
});

const interval = setInterval(() => {
    server.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            if (rooms[ws.connectionId]) {
                rooms[ws.connectionId].delete(ws);
                if (!rooms[ws.connectionId].size) delete rooms[ws.connectionId];
            }
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

server.on("close", () => clearInterval(interval));