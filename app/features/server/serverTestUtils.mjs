import WebSocket from "ws";

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

    /**
     * Sends a message over the WebSocket and waits for a response of the specified type.
     *
     * @param {Object} message - The message object to send through the WebSocket.
     * @param {string} responseType - The expected type of the response message to resolve the promise.
     * @returns {Promise<Object>} A promise that resolves with the response data object when a message of the specified type is received,
     * or rejects if the WebSocket is not open, if there is an error sending the message, or if the response cannot be parsed by JSON.parse().
     */
    sendAndWaitForResponse(message, responseType) {
        return new Promise((resolve, reject) => {
            if (this.readyState !== this.OPEN) return reject(new Error('WebSocket is not open'));
            const listener = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === responseType) resolve(data);
                } catch (err) {
                    reject(new Error('Error parsing message: ' + err));
                }
            };
            this.addEventListener('message', listener);
            this.send(JSON.stringify(message), err => err && reject(new Error('WebSocket send error: ' + err)));
        });
    }
}