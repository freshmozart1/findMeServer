import { describe, it, expect, beforeEach, afterEach, onTestFinished } from "vitest";
import { test } from "./serverTestUtils.mjs";

describe("Test WebSocket Server connection", () => {
    test('should open a WebSocket connection', ({ roomOpener }) => {
        expect(roomOpener.readyState).toBe(roomOpener.OPEN);
    });

    test('should respond with a ping upon a pong', async ({ roomOpener }) => {
        await new Promise((resolve) => {
            let pingCount = 0;
            const pingListener = ({ data }) => {
                if (JSON.parse(data).type === 'ping') {
                    pingCount++;
                    if (pingCount === 2) {
                        roomOpener.removeEventListener('message', pingListener);
                        resolve();
                    }
                }
            };
            roomOpener.addEventListener('message', pingListener);
            roomOpener.send(JSON.stringify({ type: 'pong' }));
        });
    });

    test('should respond with a created message upon a create message', async ({ roomOpener }) => {
        await new Promise((resolve, reject) => {
            const createdListener = ({ data }) => {
                const message = JSON.parse(data);
                expect(message).toBeDefined();
                if (message.type === 'ping') return;
                if (message.type === 'created') {
                    expect(message).toEqual({ type: 'created', roomId: expect.any(String), userId: expect.any(String) });
                    roomOpener.removeEventListener('message', createdListener);
                    resolve();
                } else reject(new Error(`Unexpected message type: ${message.type}`));
            };
            roomOpener.addEventListener('message', createdListener);
            roomOpener.send(JSON.stringify({ type: 'create', lat: 0, lng: 0 }));
        });
    });
});
