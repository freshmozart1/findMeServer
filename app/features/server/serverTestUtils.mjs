import WebSocket from "ws";
import { getConfig } from "./getConfig.mjs";
import { startServer } from "./server.mjs";
import { createServer, Server, IncomingMessage, ServerResponse } from "https";
import { readFileSync } from "fs";


/**
 * 
 * @returns {Promise<Server<typeof IncomingMessage, typeof ServerResponse>>}
 */
export async function startTestServer() {
    const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, databaseId } = getConfig();
    const httpServer = createServer({
        cert: readFileSync('./certificates/localhost.pem'),
        key: readFileSync('./certificates/localhost-key.pem')
    });
    await startServer({
        httpServer,
        firebaseConfig: {
            apiKey,
            authDomain,
            projectId,
            storageBucket,
            messagingSenderId,
            appId
        },
        databaseId
    });
    return new Promise(resolve => httpServer.listen(8080, () => {
        console.log(`Test server runs on ${httpServer.address().address}:${httpServer.address().port}`);
        resolve(httpServer);
    }));
}

export class TestWebSocket extends WebSocket {
    constructor(url, options = {}) {
        super(url, {
            ...options,
            rejectUnauthorized: false
        })
    }
    /**
     * 
     * @param {'open' | 'close'} state 
     * @param {number} [timeout] 
     * @returns {void | Promise<void>}
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
                console.log(`readyState: ${this.readyState}, state: ${state}`);
                reject(new Error(`WebSocket did not ${state} in time`));
            }, timeout);
        });
    }
}