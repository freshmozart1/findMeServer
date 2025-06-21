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
            time: expect.any(Object)
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

    test('should add a second member to a room', { timeout: 4000 }, async ({ database }) => {
        let locationMessageJoiner = null;
        const roomOpener = new RoomMember(database, {
            send: vi.fn(),
            terminate: vi.fn()
        });

        const roomJoiner = new RoomMember(database, {
            send: (message) => {
                locationMessageJoiner = JSON.parse(message);
            },
            terminate: vi.fn()
        });
        await roomOpener.createRoom(0, 0);
        expect(roomOpener.roomId).toBeDefined();
        expect(roomOpener.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: true
        });
        expect((await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).get()).docs).toHaveLength(1);
        await roomJoiner.joinRoom(roomOpener.roomId, 1, 1);
        expect(roomJoiner.roomId).toBe(roomOpener.roomId);
        expect(roomJoiner.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomJoiner.id}`).get()).resolves.toMatchObject({
            exists: true
        });
        expect((await database.collection(`${roomOpener.roomId}/${roomJoiner.id}/locations`).get()).docs).toHaveLength(1);
        await expect.poll(() => {
            console.log(roomOpener.id);
            console.log('Waiting for location message joiner:', locationMessageJoiner);
            return locationMessageJoiner;
        }, { timeout: 3000, interval: 1000 }).toEqual({
            type: 'location',
            userId: roomOpener.id,
            lat: 0,
            lng: 0,
            time: expect.any(Object)
        });
    });
});
