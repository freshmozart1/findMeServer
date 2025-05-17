import { WebSocketServer } from "ws";
import { Server as SecureServer } from 'https';
import { Server } from "http";
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
    getFirestore,
    collection,
    query,
    getDocs,
    doc,
    addDoc,
    onSnapshot,
    deleteDoc,
    updateDoc,
    setDoc,
    getDoc,
    limit,
    Firestore,
    CollectionReference,
    DocumentReference
} from "firebase/firestore";
import {
    DatabaseNotInitializedError,
    UserNotInRoomError,
    NoUserIdError,
    LatitudeRequiredError,
    LongitudeRequiredError,
    LatitudeError,
    LongitudeError
} from "./errors.mjs";
/**
 * The function to start the WebSocket backend of the FindMe web app.
 * @param {object} options An object containing the options for the server
 * @param {object} options.firebaseConfig The Firebase configuration object
 * @param {string} options.databaseId The id of the Firestore database to use
 * @param {number} [options.port=8080] The optional port to start the server on. The default is 8080. Port will be ignored if a http server is provided.
 * @param {SecureServer | Server } [options.httpServer] The optional HTTP server to use
 * @param {function} [options.onLog] The function to call for logging
 * @returns {SecureServer<typeof WebSocket, typeof IncomingMessage> | Server<typeof WebSocket, typeof IncomingMessage>}
 * @throws if Firebase initialization fails
 */
export async function startServer({
    firebaseConfig,
    databaseId,
    port = 8080,
    httpServer = undefined,
    onLog = console.log
}) {
    /**
     * @type {FirebaseApp} The main Firebase app instance needed for the Firestore database
     */
    let app;
    /**
     * @type {Firestore} The main Firestore database instance responsible for all rooms
     */
    let db;

    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app, databaseId);
    } catch (error) {
        onLog(`Error initializing Firebase: ${error}`);
        throw error;
    }

    const server = new WebSocketServer(httpServer ? { server: httpServer } : { port });

    /**
     * Checks if the WebSocket connection is alive by sending a ping message.
     * @param {WebSocket} ws The WebSocket connection to check
     */
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

    /**
     * Generates a random room id for a room that should be stored in the database.
     * @returns {string} A random room ID
     */
    function generateRoomId() {
        return Array.from({ length: 4 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join('');
    }

    /**
     * Checks if a room exists in the database.
     * @param {string} roomId The ID of the room to check
     * @returns {Promise<boolean> | boolean} True if the room exists, false otherwise
     * @throws if the Firestore database is not initialized or if the room ID is not provided
     */
    async function roomExists(roomId) {
        if (!db) throw new DatabaseNotInitializedError();
        if (!roomId) throw new Error("Room ID is required");
        return !(await getDocs(query(collection(db, roomId), limit(1)))).empty;
    }

    /**
     * Ensures that the WebSocket connection has a user id and a room id.
     * @param {WebSocket} ws The WebSocket connection of the user
     * @throws if the WebSocket connection does not have a user id or a room id
     */
    function wsHasIdAndRoomId(ws) {
        if (!ws.roomId) throw new UserNotInRoomError();
        if (!ws.id) throw new NoUserIdError();
    }

    /**
     * Creates a new room in the database.
     * @param {WebSocket} ws The WebSocket connection of the user that created the room
     * @param {number} lat The latitude of the user that created the room
     * @param {number} lng The longitude of the user that created the room
     * @param {number} time The time the room was created
     * @throws if the Firestore database is not initialized, if the user is already in a room, if the latitude or longitude is not provided, if the latitude or longitude is invalid, or if the time is not provided
     */
    async function createRoom(ws, lat, lng, time) {
        if (!db) throw new DatabaseNotInitializedError();
        if (ws.roomId) throw new Error("Already in a room");
        ensureValidGeoLocation(lat, lng);
        if (!time) throw new Error("Time is required");
        do { ws.roomId = generateRoomId(); } while (await roomExists(ws.roomId));
        await joinRoom(ws, lat, lng, time);
        ws.send(JSON.stringify({
            type: 'created',
            roomId: ws.roomId,
            userId: ws.id
        }));
    }

    /**
     * Adds a user to an existing room.
     * @param {WebSocket} ws The WebSocket connection of the user that wants to join the room
     * @param {number} lat The latitude of the user that wants to join the room
     * @param {number} lng The longitude of the user that wants to join the room
     * @param {number} time The time the user joined the room
     * @throws if the Firestore database is not initialized, if the user is already in a room or the given room, if the latitude or longitude is not provided, if the latitude or longitude is invalid, or if the time is not provided
     */
    async function joinRoom(ws, lat, lng, time) {
        ensureValidGeoLocation(lat, lng);
        if (!time) throw new Error("Time is required");
        const roomRef = collection(db, ws.roomId);
        const userObject = { joinedAt: time, lost: false };
        if (!ws.id) {
            ws.id = (await addDoc(roomRef, userObject)).id;
        } else {
            const userRef = doc(roomRef, ws.id);
            await ((await getDoc(userRef)).exists()
                ? updateDoc(userRef, userObject)
                : setDoc(userRef, userObject));
        }
        ws.roomSnapshot = onSnapshot(roomRef, snap => snap.docChanges().forEach(change => {
            const type = change.type;
            const userDoc = change.doc;
            const userId = userDoc.id;
            if (type === 'added' && userId !== ws.id) subscribeToLocation(ws, userId);
            else if (type === 'removed') {
                if (userId !== ws.id) unsubscribeFromLocation(ws, userId);
                ws.send(JSON.stringify({
                    type: 'left',
                    userID: userId
                }));
            } else if ((type === 'modified') && (userId !== ws.id) && userDoc.data().lost) {
                ws.send(JSON.stringify({
                    type: 'lost',
                    userID: userId
                }));
            }
        }));
        await updateLocation(ws, lat, lng, time);
    }

    /**
     * Removes a user from a room.
     * @param {WebSocket} ws The WebSocket connection of the user that wants to leave the room
     * @throws if the Firestore database is not initialized, if the user is not in a room, if the ws object has no user id, or if it has no room snapshot
     */
    async function leaveRoom(ws) {
        if (!db) throw new DatabaseNotInitializedError();
        wsHasIdAndRoomId(ws);
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

    /**
     * Validates a geographical location.
     * @param {number} lat The latitude to validate
     * @param {number} lng The longitude to validate
     * @returns {void}
     * @throws if the latitude or longitude is invalid
     */
    function ensureValidGeoLocation(lat, lng) {
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < -90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < -180 || lng > 180) throw new LongitudeError();
    }

    /**
     * Gets the location collection for a specific user in a room.
     * @param {string} roomId The ID of the room
     * @param {string} userId The ID of the user
     * @returns {CollectionReference} The location collection for the user
     * @throws if the room ID or user ID is not provided
     */
    function getLocationCollection(roomId, userId) {
        if (!roomId) throw new Error("Room id is required");
        if (!userId) throw new Error("User id is required");
        return collection(db, roomId, userId, 'locations');
    }

    /**
     * Updates the location of a user in a room.
     * @param {WebSocket} ws The WebSocket connection of the user
     * @param {number} lat The latitude of the user's location
     * @param {number} lng The longitude of the user's location
     * @param {number} time The timestamp of the location update
     * @returns {Promise<DocumentReference>} A promise that resolves to the document reference of the location
     * @throws if the Firestore database is not initialized, if the user is not in a room, if the ws object has no user id, if the latitude or longitude is not provided, if the latitude or longitude is invalid, or if the time is not provided
     */
    async function updateLocation(ws, lat, lng, time) {
        if (!db) throw new DatabaseNotInitializedError();
        wsHasIdAndRoomId(ws);
        ensureValidGeoLocation(lat, lng);
        if (!time) throw new Error("Time is required");
        return await addDoc(getLocationCollection(ws.roomId, ws.id), { lat, lng, time });
    }

    /**
     * Subscribes to the location updates of a user in a room.
     * @param {WebSocket} ws The WebSocket connection of the user
     * @param {string} userId The user id of the user to subscribe to
     * @throws if the user is not in a room, if the ws object has no user id, or if the ws user id is the same as the function parameter
     */
    function subscribeToLocation(ws, userId) {
        if (!db) throw new DatabaseNotInitializedError();
        wsHasIdAndRoomId(ws);
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

    /**
     * Unsubscribes from the location updates of a user in a room. You must provide either the user id or the index of the location snapshot to unsubscribe from.
     * @param {WebSocket} ws The WebSocket connection of the user
     * @param {string} [userId=undefined] The user id of the user to unsubscribe from
     * @param {number} [index=undefined] The index of the location snapshot to unsubscribe from
     * @returns {void}
     * @throws if the WebSocket connection is not provided, if the location snapshots are not initialized, if the WebSocket has no user id, or if neither the user id nor the index is provided
     */
    function unsubscribeFromLocation(ws, userId = undefined, index = undefined) {
        if (!db) throw new DatabaseNotInitializedError();
        wsHasIdAndRoomId(ws);
        if (!ws) throw new Error("WebSocket is required to unsubscribe from location");
        if (!ws.locationSnapshots) throw new Error("Location snapshots are not initialized");
        if (index === undefined || index === null) {
            if (!userId) throw new Error("User ID is required to unsubscribe from location when index is not provided");
            if (ws.id === userId) throw new Error("Cannot unsubscribe from own location");
            index = ws.locationSnapshots.findIndex(({ userId: _userId }) => _userId === userId);
        } else if (typeof index !== 'number' || index < 0 || index >= ws.locationSnapshots.length) return;
        ws.locationSnapshots[index].unsubscribe();
        ws.locationSnapshots.splice(index, 1);
    }

    /**
     * Handles incoming messages from clients.
     * @param {WebSocket} ws The WebSocket connection of the user
     * @param {string} message The incoming message
     */
    async function receivedMessage(ws, message) {
        try {
            const { type: messageType, lat, lng, roomId, userId, time } = JSON.parse(message);
            if (!messageType) throw new Error("Message type is required");
            switch (messageType) {
                case 'pong': return checkAlive(ws);
                case 'create':
                    await createRoom(ws, lat, lng, time);
                    break;
                case 'join':
                    if (!roomExists(roomId)) throw new Error("Room does not exist");
                    else {
                        ws.roomId = roomId;
                        ws.id = userId;
                        await joinRoom(ws, lat, lng, time);
                    }
                    break;
                case 'leave':
                    await leaveRoom(ws);
                    break;
                case 'location':
                    await updateLocation(ws, lat, lng, time);
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
            if (ws.roomId) leaveRoom(ws);
            clearTimeout(ws.heartbeatTimeout);
        });
    });

    return server;
}