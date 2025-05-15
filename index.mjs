import { WebSocketServer } from "ws";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, getDocs, doc, addDoc, onSnapshot, deleteDoc, updateDoc } from "firebase/firestore";
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

function checkAlive(ws) {
    ws.send(JSON.stringify({ type: 'ping' }));
    clearTimeout(ws.heartbeatTimeout);
    ws.heartbeatTimeout = setTimeout(async () => {
        if (ws.roomId) {
            await updateDoc(doc(db, ws.roomId, ws.id), { lost: true });
        }
        ws.terminate();
    }, 30000);
}

function generateRoomId() {
    return Array.from({ length: 4 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join('');
}

function validGeoLocation(lat, lng) {
    if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error("Latitude and Longitude must be numbers");
    if (lat < -90 || lat > 90) throw new Error("Latitude must be between -90 and 90");
    if (lng < -180 || lng > 180) throw new Error("Longitude must be between -180 and 180");
    return true;
}

async function createRoom(ws, lat, lng, time) {
    if (!db) throw new Error("Firebase not initialized");
    if (ws.roomId) throw new Error("Already in a room");
    if (!lat || !lng) throw new Error("Latitude and Longitude are required");
    if (!validGeoLocation(lat, lng)) throw new Error("Invalid Latitude and Longitude");
    if (!time) throw new Error("Time is required");
    do { ws.roomId = generateRoomId(); } while (await getRoomIfExists(ws.roomId));
    await joinRoom(ws, lat, lng, time);
    ws.send(JSON.stringify({
        type: 'created',
        roomId: ws.roomId,
        userId: ws.id
    }));
}

function subscribeToLocation(ws, userId) {
    if (ws.id === userId) throw new Error("Cannot subscribe to own location");
    const unsubscribe = onSnapshot(getLocationCollection(ws.roomId, userId), locSnap => {
        locSnap.docChanges().forEach(({ type, doc }) => {
            if (type === 'added') {
                const { lat: changedLat, lng: changedLng, time: changedTime } = doc.data();
                ws.send(JSON.stringify({
                    type: 'location',
                    roomId: ws.roomId,
                    userId,
                    lat: changedLat,
                    lng: changedLng,
                    time: changedTime
                }));
            }
        })
    });
    ws.locationSnapshots.push({
        userId,
        unsubscribe
    });
}

function unsubscribeFromLocation(ws, userId = undefined, index = undefined) {
    if (!ws) throw new Error("WebSocket is required to unsubscribe from location");
    if (!ws.locationSnapshots) throw new Error("Location snapshots are not initialized");
    if (!ws.id) throw new Error("WebSocket is not a member of a room");
    if (index === undefined || index === null) {
        if (!userId) throw new Error("User ID is required to unsubscribe from location when index is not provided");
        if (ws.id === userId) throw new Error("Cannot unsubscribe from own location");
        index = ws.locationSnapshots.findIndex(({ userId: _userId }) => _userId === userId);
    } else if (typeof index !== 'number' || index < 0 || index >= ws.locationSnapshots.length) return;
    ws.locationSnapshots[index].unsubscribe();
    ws.locationSnapshots.splice(index, 1);
}

function getLocationCollection(roomId, userId) {
    if (!roomId) throw new Error("Room id is required");
    if (!userId) throw new Error("User id is required");
    return collection(db, roomId, userId, 'locations');
}

async function joinRoom(ws, lat, lng, time) {
    if (!db) throw new Error("Firebase not initialized");
    if (!ws.roomId) throw new Error("Room ID is required");
    if (!lat || !lng) throw new Error("Latitude and Longitude are required");
    if (!validGeoLocation(lat, lng)) throw new Error("Invalid Latitude and Longitude");
    if (!time) throw new Error("Time is required");
    const roomRef = collection(db, ws.roomId);
    ws.id = (await addDoc(roomRef, { joinedAt: time, lost: false })).id;
    ws.roomSnapshot = onSnapshot(roomRef, snap => snap.docChanges().forEach(change => {
        const type = change.type;
        const userDoc = change.doc;
        const userId = userDoc.id;
        const lost = userDoc.data().lost;
        if (type === 'added' && userId !== ws.id) subscribeToLocation(ws, userId);
        else if (type === 'removed') {
            if (userId !== ws.id) unsubscribeFromLocation(ws, userId);
            ws.send(JSON.stringify({
                type: 'left',
                userID: userId
            }));
        } else if ((type === 'modified') && (userId !== ws.id) && lost) {
            ws.send(JSON.stringify({
                type: 'lost',
                userID: userId
            }));
        }
    }));
    await addDoc(getLocationCollection(ws.roomId, ws.id), { lat, lng, time });
}

async function leaveRoom(ws) {
    if (!db) throw new Error("Firebase not initialized");
    if (!ws.roomId) throw new Error("Room ID is required");
    if (!ws.id) throw new Error("User ID is required");
    if (!ws.roomSnapshot) throw new Error("Room snapshot is not initialized");
    const memberRef = doc(db, ws.roomId, ws.id);
    await Promise.all([...(await getDocs(query(collection(memberRef, 'locations')))).docs.map(docSnap => deleteDoc(docSnap.ref)), deleteDoc(memberRef)]);
    ws.locationSnapshots.forEach((snap, index) => snap.unsubscribe(ws, undefined, index));
    ws.locationSnapshots = [];
    ws.roomSnapshot && ws.roomSnapshot();
    ws.roomId = undefined;
    ws.id = undefined;
    ws.roomSnapshot = undefined;
}

async function receivedMessage(ws, message) {
    try {
        const { type: messageType, lat, lng, roomId, time } = JSON.parse(message);
        if (!messageType) throw new Error("Message type is required");
        switch (messageType) {
            case 'pong': return checkAlive(ws);
            case 'create':
                await createRoom(ws, lat, lng, time);
                break;
            case 'join':
                ws.roomId = roomId;
                await joinRoom(ws, lat, lng, time);
                break;
            case 'leave':
                await leaveRoom(ws);
                break;
            default:
                throw new Error("Invalid message type");
        }
    } catch (error) {
        ws.close(1011, error.message ?? error);
        console.error("Error processing message:", error);
    }
}

server.on("connection", (ws) => {
    Object.assign(ws, { roomId: undefined, id: undefined, roomSnapshot: undefined, locationSnapshots: [], heartbeatTimeout: undefined });
    checkAlive(ws);
    ws.on('message', (message) => receivedMessage(ws, message));
    ws.on('close', async () => {
        console.log('Client disconnected');
        if (ws.roomId) leaveRoom(ws);
        clearTimeout(ws.heartbeatTimeout); // clear heartbeat timeout on disconnect
    });
});