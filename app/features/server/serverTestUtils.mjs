import WebSocket from "ws";
import { test as baseTest } from "vitest";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { initializeApp } from "firebase-admin/app";
import admin from "firebase-admin";
import serviceAccount from "../../../firebase.secret.json" assert { type: "json" };

initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

export const test = baseTest.extend({
    /** @type {TestServer} */
    websocket: async ({ }, use) => {
        const websocket = new TestServer('ws://localhost:8080');
        await websocket.waitUntil('open');
        await use(websocket);
        websocket.close();
    },
    /** @type {Firestore} */
    database: async ({ }, use) => {
        await use(getFirestore(undefined, 'findme-db'));
    }
});

export class TestServer extends WebSocket {
    /**
     * Creates a TestServer for testing a WebSocket server, initializing it with the specified URL and options.
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