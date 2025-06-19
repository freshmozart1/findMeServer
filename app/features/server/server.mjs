import { WebSocketServer, WebSocket } from "ws";
import { Firestore } from "firebase-admin/firestore";
import { DatabaseNotInitializedError, MessageError, MessageTypeRequiredError, WebSocketError } from "./errors.mjs";
import { RoomMember } from "../room/roomMember.mjs";

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
    constructor(firestoreDatabase, webSocketServerOptions, onLog = console.log) {
        if (!firestoreDatabase) throw new DatabaseNotInitializedError();
        super(webSocketServerOptions);
        this.#firestoreDatabase = firestoreDatabase;
        this.#onLog = onLog;
        this.on('connection', (ws) => {
            if (!ws) throw new WebSocketError();
            const roomMember = new RoomMember(this.#firestoreDatabase, ws);
            this.#checkAlive(roomMember);
            ws.on('message', async message => {
                try {
                    if (!message) throw new MessageError();
                    const messageString = message.toString('utf8');
                    const jsonMessage = JSON.parse(messageString);
                    const { type: messageType, lat, lng, roomId } = jsonMessage;
                    if (!messageType) throw new MessageTypeRequiredError();
                    switch (messageType) {
                        case 'pong': this.#checkAlive(roomMember); break;
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
                    if (roomMember.roomId && roomMember.id) {
                        await roomMember.leaveRoom();
                    }
                    clearTimeout(roomMember.heartbeatTimeout);
                    ws.close(1011, error.message ?? 'Unknown error');
                }
            });
            ws.on('close', async () => {
                if (roomMember.roomId && roomMember.id) {
                    await roomMember.leaveRoom();
                }
                clearTimeout(roomMember.heartbeatTimeout);
            });
        });
    }

    /**
     * Checks if the WebSocket connection is alive by sending a ping message.
     * @param {RoomMember} roomMember The WebSocket connection to check
     */
    #checkAlive(roomMember) {
        roomMember.ws.send(JSON.stringify({ type: "ping" }));
        clearTimeout(roomMember.heartbeatTimeout);
        roomMember.heartbeatTimeout = setTimeout(async () => {
            if (roomMember.roomId && roomMember.id) {
                if (!this.#firestoreDatabase) throw new DatabaseNotInitializedError();
                await this.#firestoreDatabase.runTransaction(async transaction => {
                    if ((await transaction.get(roomMember.ref)).exists()) {
                        transaction.update(roomMember.ref, { lost: true });
                    }
                });
            }
            roomMember.ws.terminate();
        }, 30000);
    }
}