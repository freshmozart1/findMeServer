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

    test('should remove a member from a room', { timeout: 3000 }, async ({ database }) => {
        let parsedMessage = null;
        const roomOpener = new RoomMember(database, {
            send: (message) => {
                parsedMessage = JSON.parse(message);
            }, terminate: vi.fn()
        });
        await roomOpener.createRoom(0, 0);
        expect(roomOpener.roomId).toBeDefined();
        expect(roomOpener.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: true
        });
        expect((await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).get()).docs).toHaveLength(1);
        const userId = roomOpener.id; // Store userId before leaving the room
        await roomOpener.leaveRoom();
        await expect.poll(() => parsedMessage, { timeout: 3000, interval: 1000 }).toEqual({
            type: 'left',
            userId
        });
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: false
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

    test('should add a second member to a room', { timeout: 3000 }, async ({ database }) => {
        let parsedMessage = null;
        const roomOpener = new RoomMember(database, {
            send: vi.fn(),
            terminate: vi.fn()
        });

        const roomJoiner = new RoomMember(database, {
            send: (message) => {
                parsedMessage = JSON.parse(message);
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
        await expect.poll(() => parsedMessage, { timeout: 2000, interval: 500 }).toEqual({
            type: 'location',
            userId: roomOpener.id,
            lat: 0,
            lng: 0,
            time: expect.any(Object)
        });
    });

    test('should remove a second member from a room', { timeout: 3000 }, async ({ database }) => {
        let parsedMessageJoiner = null;
        let parsedMessageOpener = null;
        const roomOpener = new RoomMember(database, {
            send: (message) => {
                parsedMessageOpener = JSON.parse(message);
            },
            terminate: vi.fn()
        });

        const roomJoiner = new RoomMember(database, {
            send: (message) => {
                parsedMessageJoiner = JSON.parse(message);
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
        const roomJoinerId = roomJoiner.id; // Store userId before leaving the room
        await roomJoiner.leaveRoom();
        await expect.poll(() => parsedMessageJoiner, { timeout: 2000, interval: 500 }).toEqual({
            type: 'left',
            userId: roomJoinerId
        });
        await expect.poll(() => parsedMessageOpener, { timeout: 2000, interval: 500 }).toEqual({
            type: 'left',
            userId: roomJoinerId
        });
        await expect(database.doc(`${roomOpener.roomId}/${roomJoinerId}`).get()).resolves.toMatchObject({
            exists: false
        });
    });

    test('should update location of a member in a room', async ({ database }) => {
        const roomOpener = new RoomMember(database, {
            send: vi.fn(),
            terminate: vi.fn()
        });
        await roomOpener.createRoom(0, 0);
        expect(roomOpener.roomId).toBeDefined();
        expect(roomOpener.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: true
        });
        await roomOpener.updateLocation(1, 1);
        const location = (await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).orderBy('time', 'desc').limit(1).get());
        expect(location.docs).toHaveLength(1);
        expect(location.docs[0].data()).toMatchObject({
            lat: 1,
            lng: 1
        });
        await roomOpener.leaveRoom();
    });

    test('should update location of a member in a room with multiple members', { timeout: 4000 }, async ({ database }) => {
        let openerMsg = null, joinerMsg = null;
        const roomOpener = new RoomMember(database, { send: m => openerMsg = JSON.parse(m), terminate: vi.fn() });
        const roomJoiner = new RoomMember(database, { send: m => joinerMsg = JSON.parse(m), terminate: vi.fn() });

        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.roomId, 1, 1);

        await roomOpener.updateLocation(2, 2);
        await expect.poll(() => joinerMsg, { timeout: 2000, interval: 500 }).toEqual({
            type: 'location', userId: roomOpener.id, lat: 2, lng: 2, time: expect.any(Object)
        });

        await roomJoiner.updateLocation(3, 3);
        await expect.poll(() => openerMsg, { timeout: 2000, interval: 500 }).toEqual({
            type: 'location', userId: roomJoiner.id, lat: 3, lng: 3, time: expect.any(Object)
        });

        await roomOpener.leaveRoom();
        await roomJoiner.leaveRoom();
    });
});
