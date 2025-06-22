import { WebSocketServer, WebSocket } from "ws";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { MessageError, MessageTypeRequiredError, WebSocketError } from "./errors.mjs";
import { RoomMember } from "../room/roomMember.mjs";
import { initializeApp } from "firebase-admin/app";
import { createRequire } from "module";
import admin from "firebase-admin";
const require = createRequire(import.meta.url);

initializeApp({
    credential: admin.credential.cert(require("../../../firebase.secret.json"))
});

/**
 * @todo #1
 */

/**
 * The FindMeServer class extends the WebSocketServer class to create a WebSocket server for the FindMe web app.
 * It initializes the server with the provided Firebase app and Firestore database.
 * @extends {WebSocketServer}
 */
export class FindMeServer extends WebSocketServer {
    /**
     * A function to log messages, defaults to console.log
     * @private
     * @type {function(string): void}
     */
    #onLog;
    /**
     * @private
     * @type {Firestore} The main Firestore database instance responsible for all rooms
     */
    #firestoreDatabase;
    /**
     * @param {Firestore} firestoreDatabase
     * @param {WebSocket.ServerOptions} webSocketServerOptions
     */
    constructor(webSocketServerOptions, onLog = console.log) {
        super(webSocketServerOptions);
        this.#firestoreDatabase = getFirestore(undefined, 'findme-db');
        this.#onLog = onLog;
        this.on('connection', (ws) => {
            if (!ws) throw new WebSocketError();
            const roomMember = new RoomMember(this.#firestoreDatabase, ws);
            ws.on('message', async message => {
                try {
                    if (!message) throw new MessageError();
                    const messageString = message.toString('utf8');
                    const jsonMessage = JSON.parse(messageString);
                    const { type: messageType, lat, lng, roomId } = jsonMessage;
                    if (!messageType) throw new MessageTypeRequiredError();
                    switch (messageType) {
                        case 'pong': roomMember.checkAlive();
                            break;
                        case 'create':
                            await roomMember.createRoom(lat, lng);
                            break;
                        case 'join':
                            await roomMember.joinRoom(roomId, lat, lng);
                            break;
                        default: throw new Error(`Unknown message type: ${messageType}`);
                    }
                }
                catch (error) {
                    this.#onLog(`Error processing message: ${error.message ?? 'Unknown error'}`);
                    this.#onLog(error.stack ?? 'No stack trace');
                    await roomMember.leaveRoom();
                    clearTimeout(roomMember.heartbeatTimeout);
                    ws.close(1011, error.message ?? 'Unknown error');
                }
            });
        });
    }
}