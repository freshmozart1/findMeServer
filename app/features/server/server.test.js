import { describe, expect, vi } from "vitest";
import { test } from "./serverTestUtils.mjs";
import { RoomMember } from "../room/roomMember.mjs";

describe('server.mjs', () => {
test('Client should open a WebSocket connection', ({ websocket }) => {
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
});

describe("RoomMember.mjs", () => {

    test('Remove member from room after 30s of inactivity', { timeout: 32000 }, async ({ database }) => {
        await new Promise(async (resolve, reject) => {
            const roomOpener = new RoomMember(database, {
                send: async (message) => {
                    const parsedMessage = JSON.parse(message);
                    if (parsedMessage.type === 'left') {
                        try {
                            expect(parsedMessage).toEqual({
                                type: 'left',
                                userId: expect.any(String)
                            });
                            expect(((await database.doc(`${roomOpener.roomId}/${parsedMessage.userId}`).get()).exists)).toBeFalsy();
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    }
                }, terminate: vi.fn()
            });
            await roomOpener.createRoom(0, 0);
        });
    });
});
