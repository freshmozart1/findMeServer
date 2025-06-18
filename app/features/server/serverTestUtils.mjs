import WebSocket from "ws";
import { test as baseTest } from "vitest";
import { getConfig } from "./getConfig.mjs";
import { collection, doc, getDoc, getFirestore } from "firebase/firestore";
import { initializeApp } from "firebase/app";

const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, databaseId } = getConfig();
const database = getFirestore(initializeApp({ apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId }), databaseId);

export async function userInRoom(roomId, userId) {
    return (await getDoc(doc(database, roomId, userId))).exists();
}


async function roomOpener({ }, use) {
    const _roomOpener = new TestWebSocket('ws://localhost:8080');
    await _roomOpener.waitUntil('open');
    await use(_roomOpener);
    _roomOpener.close();
}
export const test = baseTest.extend({
    /** @type {TestWebSocket} */
    roomOpener
});

export class TestWebSocket extends WebSocket {
    /**
     * Creates a TestWebSocket for testing a WebSocket server, initializing it with the specified URL and options.
     * Extends the parent WebSocket class, ensuring that the connection does not reject unauthorized SSL certificates.
     *
     * @param {string} url - The URL to connect to.
     */
    constructor(url) {
        super(url, { rejectUnauthorized: false });
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