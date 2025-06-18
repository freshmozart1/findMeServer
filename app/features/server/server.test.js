import { describe, it, expect, beforeEach, afterEach, onTestFinished } from "vitest";
import { test, userInRoom } from "./serverTestUtils.mjs";

describe("Test WebSocket Server connection", () => {
    test('should open a WebSocket connection', ({ websocket }) => {
        expect(websocket.readyState).toBe(websocket.OPEN);
    });

    test('should respond with a ping upon a pong', async ({ websocket }) => {
        await new Promise((resolve) => {
            let pingCount = 0;
            const pingListener = ({ data }) => {
                if (JSON.parse(data).type === 'ping') {
                    pingCount++;
                    if (pingCount === 2) {
                        websocket.removeEventListener('message', pingListener);
                        resolve();
                    }
                }
            };
            websocket.addEventListener('message', pingListener);
            websocket.send(JSON.stringify({ type: 'pong' }));
        });
    });

    test('should respond with a created message upon a create message', async ({ websocket }) => {
        await new Promise((resolve, reject) => {
            const createdListener = async ({ data }) => {
                const message = JSON.parse(data);
                expect(message).toBeDefined();
                if (message.type === 'ping') return;
                if (message.type === 'created') {
                    expect(message).toEqual({ type: 'created', roomId: expect.any(String), userId: expect.any(String) });
                    await expect(userInRoom(message.roomId, message.userId)).resolves.toBeTruthy();
                    websocket.removeEventListener('message', createdListener);
                    resolve();
                } else reject(new Error(`Unexpected message type: ${message.type}`));
            };
            websocket.addEventListener('message', createdListener);
            websocket.send(JSON.stringify({ type: 'create', lat: 0, lng: 0 }));
        });
    });
});
