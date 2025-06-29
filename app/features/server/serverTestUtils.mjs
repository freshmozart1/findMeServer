import WebSocket from "ws";
import { test as baseTest, vi } from "vitest";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import admin from "firebase-admin";
import serviceAccount from "../../../firebase.secret.json" assert { type: "json" };
import { RoomMember } from "../room/roomMember.mjs";

initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

/**
 * @typedef {RoomMember & {
 * getRoomId: () => string,
 * getId: () => string,
 * messages: any[],
 * getDoc: () => Promise<admin.firestore.DocumentSnapshot<admin.firestore.DocumentData, admin.firestore.DocumentData>>,
 * getLocations: () => Promise<admin.firestore.QuerySnapshot<admin.firestore.DocumentData, admin.firestore.DocumentData>> }} RoomMemberContext
 */
/**
 * This function creates a RoomMember context for testing purposes.
 * @param {Firestore} database The Firestore database instance to use for the RoomMember.
 * @param {(context: any) => Promise<any>} use The context.
 */
async function createRoomMemberContext(database, use) {
    const messages = [];
    let left = false;
    const roomMember = new RoomMember(database, {
        send: m => messages.push(JSON.parse(m)),
        terminate: vi.fn()
    });
    await use({
        getRoomId: () => roomMember.room.id,
        getId: () => roomMember.id,
        createRoom: (latitude, longitude) => roomMember.createRoom(latitude, longitude),
        joinRoom: (roomId, latitude, longitude) => roomMember.joinRoom(roomId, latitude, longitude),
        updateLocation: (latitude, longitude) => roomMember.updateLocation(latitude, longitude),
        proposeLocation: (location) => roomMember.proposeLocation(location),
        leaveRoom: () => {
            left = true;
            return roomMember.leaveRoom()
        },
        getDoc: () => database.doc(`${roomMember.room.id}/${roomMember.id}`).get(),
        getLocations: () => database.collection(`${roomMember.room.id}/${roomMember.id}/locations`).get(),
        messages
    });
    if (!left) await roomMember.leaveRoom();
}

export const test = baseTest.extend({
    /** @type {TestWebSocket} */
    websocketJoiner: async ({ }, use) => {
        const websocket = new TestWebSocket('ws://localhost:8080');
        await websocket.waitUntil('open');
        await use(websocket);
        if (!websocket.CLOSED) websocket.close(1000, 'Normal closure');
    },
    /** @type {TestWebSocket} */
    websocketOpener: async ({ }, use) => {
        const websocket = new TestWebSocket('ws://localhost:8080');
        await websocket.waitUntil('open');
        await use(websocket);
        if (!websocket.CLOSED) websocket.close(1000, 'Normal closure');
    },
    /** @type {Firestore} */
    database: async ({ }, use) => {
        await use(getFirestore(undefined, 'findme-db'));
    },
    /** @type {RoomMemberContext} */
    roomOpener: async ({ database }, use) => createRoomMemberContext(database, use),
    /** @type {RoomMemberContext} */
    roomJoiner: async ({ database }, use) => createRoomMemberContext(database, use)
});

export class TestWebSocket extends WebSocket {
    messages = [];
    /**
     * Creates a TestWebSocket for testing a WebSocket server, initializing it with the specified URL and options.
     * Extends the parent WebSocket class, ensuring that the connection does not reject unauthorized SSL certificates.
     *
     * @param {string} url - The URL to connect to.
     */
    constructor(url) {
        super(url, { rejectUnauthorized: false });
        this.on('message', message => {
            this.messages.push(JSON.parse(message));
        });
    }

    /**
     * Waits until the WebSocket reaches the specified state ('open' or 'close') or until the timeout is reached.
     *
     * @param {'open' | 'close'} state - The WebSocket state to wait for ('open' or 'close').
     * @param {number} [timeout=3000] - The maximum time to wait in milliseconds before rejecting the promise.
     * @returns {Promise<void>} A promise that resolves when the WebSocket reaches the specified state, or rejects if the timeout is reached.
     */
    waitUntil(state, timeout = 3000) {
        if (this.readyState === this.OPEN && state === 'open') return;
        if (this.readyState === this.CLOSED && state === 'close') return;
        return new Promise((resolve, reject) => {
            /**
             * @type {NodeJS.Timeout | undefined}
             */
            let timerId;
            function handleStateEvent() {
                resolve();
                clearTimeout(timerId);
            }
            this.addEventListener(state, handleStateEvent, { once: true });
            timerId = setTimeout(() => {
                this.removeEventListener(state, handleStateEvent);
                if (this.readyState === this.OPEN && state === 'open') return resolve();
                if (this.readyState === this.CLOSED && state === 'close') return resolve();
                reject(new Error(`WebSocket did not ${state} in time`));
            }, timeout);
        });
    }
}