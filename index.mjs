import { WebSocketServer } from "ws";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, getDocs, doc, setDoc, addDoc, serverTimestamp, onSnapshot, deleteDoc } from "firebase/firestore";
import fs from 'fs';

const server = new WebSocketServer({ port: 8080 });
console.log("WebSocket server is running on ws://localhost:8080");

let app;
let db;
try {
    if (process.env.NODE_ENV === 'development') {
        const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, databaseId } = JSON.parse(fs.readFileSync('./firebase.secret.json', 'utf8'));
        app = initializeApp({ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId });
        db = getFirestore(app, databaseId);
    } else {
        const { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID, FIREBASE_DATABASE_ID } = process.env;
        app = initializeApp({
            apiKey: FIREBASE_API_KEY,
            authDomain: FIREBASE_AUTH_DOMAIN,
            projectId: FIREBASE_PROJECT_ID,
            storageBucket: FIREBASE_STORAGE_BUCKET,
            messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
            appId: FIREBASE_APP_ID
        });
        db = getFirestore(app, FIREBASE_DATABASE_ID);
    }
} catch (error) {
    console.error("Error initializing Firebase:", error);
    process.exit(1);
}

async function getRoomIfExists(roomId) {
    if (!db || !roomId) return false;
    try {
        const { empty, docs } = await getDocs(query(collection(db, roomId)));
        return empty ? false : docs;
    } catch (error) {
        console.error("Error getting collection:", error);
        throw error;
    }
}

async function joinRoom(ws, { lat, lng }) {
    if (!db) throw new Error("Firebase not initialized");
    try {
        const time = new Date();
        const memberRef = await addDoc(collection(db, ws.roomId), { createdAt: time });
        ws.id = memberRef.id;
        return await addDoc(collection(db, ws.roomId, ws.id, 'locations'), { lat, lng, createdAt: time });
    } catch (error) {
        console.error("Error creating collection:", error);
        throw error;
    }
}

function checkAlive(ws) {
    sendMessage(ws, 'pong');
    clearTimeout(ws.heartbeatTimeout);
    ws.heartbeatTimeout = setTimeout(() => ws.terminate(), 30000);
}

function generateRoomId() {
    return Array.from({ length: 4 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join('');
}

function addLocationSnapshot(ws, memberId) {
    ws.locationSnapshots.push(onSnapshot(collection(db, ws.roomId, memberId, 'locations'), locSnap => locSnap.docChanges().forEach(({ type, doc }) => type === 'added' && sendMessage(ws, 'location', { id: memberId, ...doc.data() }))));
}

function sendMessage(ws, type, data = undefined) {
    ws.send(JSON.stringify(data ? { type, ...data } : { type }));
}

async function receivedMessage(ws, message) {
    try {
        const { type: messageType, lat, lng, roomId } = JSON.parse(message);
        if (!messageType) throw "Message type is required";
        if (messageType === 'ping') {
            checkAlive(ws);
            return;
        };
        if ((messageType === 'new' || messageType === 'join') && (typeof lat !== 'number' || typeof lng !== 'number')) throw "Latitude and Longitude must be numbers";
        if (messageType === 'new') {
            do { ws.roomId = generateRoomId(); } while (await getRoomIfExists(ws.roomId));
            await joinRoom(ws, { lat, lng });
            sendMessage(ws, 'room', { id: ws.roomId });
        } else if (messageType === 'join') {
            if (!roomId) throw "Room ID is required";
            const room = await getRoomIfExists(roomId);
            if (!room) throw "Room not found";
            ws.roomId = roomId;
            await joinRoom(ws, { lat, lng });
        } else throw "Invalid message type";
        if (messageType === 'new' || messageType === 'join') {
            ws.roomSnapshot = onSnapshot(collection(db, ws.roomId), snap => snap.docChanges().forEach(({ type, doc: { id } }) => {
                type === 'added' && id !== ws.id && addLocationSnapshot(ws, id);
                type === 'removed' && sendMessage(ws, 'leave', { id });
            }));
        }
    } catch (error) {
        sendMessage(ws, 'error', { message: error.message || error });
    }
}

server.on("connection", (ws) => {
    Object.assign(ws, { roomId: undefined, id: undefined, roomSnapshot: undefined, locationSnapshots: [], heartbeatTimeout: undefined });
    checkAlive(ws);
    ws.on('message', (message) => receivedMessage(ws, message));
    ws.on('close', async () => {
        if (ws.roomId) {
            const memberRef = doc(db, ws.roomId, ws.id);
            await Promise.all([...(await getDocs(query(collection(memberRef, 'locations')))).docs.map(docSnap => deleteDoc(docSnap.ref)), deleteDoc(memberRef)]);
            ws.roomSnapshot && ws.roomSnapshot(); // unsubscribe from room snapshot
            ws.locationSnapshots.forEach(unsub => unsub()); // unsubscribe from location snapshots
        }
        clearTimeout(ws.heartbeatTimeout); // clear heartbeat timeout on disconnect
    });
});