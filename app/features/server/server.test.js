import { describe, expect, vi } from "vitest";
import { test } from "./serverTestUtils.mjs";
import { RoomMember } from "../room/roomMember.mjs";
import { Timestamp } from "firebase-admin/firestore";

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

    test('should create a room with the correct data', async ({ database }) => {
        let parsedMessage = null;
        const roomOpener = new RoomMember(database, {
            send: async (message) => {
                parsedMessage = JSON.parse(message);
            }, terminate: vi.fn()
        });
        await roomOpener.createRoom(0, 0);
        await expect.poll(() => parsedMessage, { timeout: 3000, interval: 1000 }).toEqual({
            type: 'created',
            roomId: roomOpener.roomId,
            userId: roomOpener.id
        });
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: true
        });
        const location = (await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).get()).docs[0].data();
        expect(location).toEqual({
            lat: 0,
            lng: 0,
            time: expect.any(Timestamp)
        });
    });

    test('Remove member from room after 30s of inactivity', { timeout: 32000 }, async ({ database }) => {
        let parsedMessage = null;
        const roomOpener = new RoomMember(database, {
            send: (message) => {
                parsedMessage = JSON.parse(message);
            }, terminate: vi.fn()
        });
        await roomOpener.createRoom(0, 0);
        await expect.poll(() => parsedMessage, { timeout: 32000, interval: 1000 }).toEqual({
            type: 'left',
            userId: roomOpener.id
        });
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: false
        });
    });
});
