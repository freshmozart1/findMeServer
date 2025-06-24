import { describe, expect, vi } from "vitest";
import { test } from "./serverTestUtils.mjs";
import { RoomMember } from "../room/roomMember.mjs";
import { database } from "firebase-admin";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";

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

    test('should create a room with correct data', async ({ database }) => {
        let messages = [];
        const roomOpener = new RoomMember(database, { send: m => messages.push(JSON.parse(m)), terminate: vi.fn() });
        const location = new GeoPoint(0, 0);
        await roomOpener.createRoom(location.latitude, location.longitude);
        await expect.poll(() => messages).toContainEqual({
            type: 'created',
            roomId: roomOpener.roomId,
            userId: roomOpener.id
        });
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({ exists: true });
        expect((await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).get()).docs.map(d => d.data()))
            .toContainEqual({
                lat: location.latitude,
                lng: location.longitude,
                time: expect.any(Timestamp)
            });
    });

    test('should remove a member from a room', async ({ database }) => {
        let messages = [];
        const roomOpener = new RoomMember(database, {
            send: (message) => {
                messages.push(JSON.parse(message));
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
        await expect.poll(() => messages).toContainEqual({
            type: 'left',
            userId
        });
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: false
        });
    });

    test('Remove member from room after 30s of inactivity', { timeout: 34000 }, async ({ database }) => {
        let messages = [];
        const roomOpener = new RoomMember(database, {
            send: (message) => {
                messages.push(JSON.parse(message));
            }, terminate: vi.fn()
        });
        await roomOpener.createRoom(0, 0);
        await expect.poll(() => messages, { timeout: 32000, interval: 1000 }).toContainEqual({
            type: 'left',
            userId: roomOpener.id
        });
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({
            exists: false
        });
    });

    test('should add a second member to a room', { timeout: 3000 }, async ({ database }) => {
        let messages = [];
        const roomOpener = new RoomMember(database, { send: vi.fn(), terminate: vi.fn() });
        const roomJoiner = new RoomMember(database, { send: m => messages.push(JSON.parse(m)), terminate: vi.fn() });

        const openerLocation = new GeoPoint(0, 0);
        await roomOpener.createRoom(openerLocation.latitude, openerLocation.longitude);
        expect(roomOpener.roomId).toBeDefined();
        expect(roomOpener.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({ exists: true });
        expect((await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).get()).docs).toHaveLength(1);

        await roomJoiner.joinRoom(roomOpener.roomId, 1, 1);
        expect(roomJoiner.roomId).toBe(roomOpener.roomId);
        expect(roomJoiner.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomJoiner.id}`).get()).resolves.toMatchObject({ exists: true });
        expect((await database.collection(`${roomOpener.roomId}/${roomJoiner.id}/locations`).get()).docs).toHaveLength(1);

        await expect.poll(() => messages).toContainEqual({
            type: 'location',
            userId: roomOpener.id,
            lat: openerLocation.latitude,
            lng: openerLocation.longitude,
            time: expect.any(Object)
        });
        await roomOpener.leaveRoom();
        await roomJoiner.leaveRoom();
    });

    test('should remove a second member from a room', async ({ database }) => {
        let joinerMsg = [], openerMsg = [];

        const roomOpener = new RoomMember(database, { send: (msg) => openerMsg.push(JSON.parse(msg)), terminate: vi.fn() });
        const roomJoiner = new RoomMember(database, { send: (msg) => joinerMsg.push(JSON.parse(msg)), terminate: vi.fn() });

        await roomOpener.createRoom(0, 0);
        expect(roomOpener.roomId).toBeDefined();
        expect(roomOpener.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({ exists: true });
        expect((await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).get()).docs).toHaveLength(1);

        await roomJoiner.joinRoom(roomOpener.roomId, 1, 1);
        expect(roomJoiner.roomId).toBe(roomOpener.roomId);
        expect(roomJoiner.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomJoiner.id}`).get()).resolves.toMatchObject({ exists: true });
        expect((await database.collection(`${roomOpener.roomId}/${roomJoiner.id}/locations`).get()).docs).toHaveLength(1);

        const roomJoinerId = roomJoiner.id; // Store userId before leaving the room
        await roomJoiner.leaveRoom();
        await expect.poll(() => joinerMsg).toContainEqual({ type: 'left', userId: roomJoinerId });
        await expect.poll(() => openerMsg).toContainEqual({ type: 'left', userId: roomJoinerId });
        await expect(database.doc(`${roomOpener.roomId}/${roomJoinerId}`).get()).resolves.toMatchObject({ exists: false });
        await roomOpener.leaveRoom();
    });

    test('should update location of a member in a room', async ({ database }) => {
        const roomOpener = new RoomMember(database, { send: vi.fn(), terminate: vi.fn() });
        await roomOpener.createRoom(0, 0);

        expect(roomOpener.roomId).toBeDefined();
        expect(roomOpener.id).toBeDefined();
        await expect(database.doc(`${roomOpener.roomId}/${roomOpener.id}`).get()).resolves.toMatchObject({ exists: true });

        const location = new GeoPoint(1, 1);
        await roomOpener.updateLocation(location.latitude, location.longitude);
        const updatedLocation = (await database.collection(`${roomOpener.roomId}/${roomOpener.id}/locations`).orderBy('time', 'desc').limit(1).get());
        expect(updatedLocation.docs).toHaveLength(1);
        expect(updatedLocation.docs[0].data()).toMatchObject({
            lat: location.latitude,
            lng: location.longitude
        });
        await roomOpener.leaveRoom();
    });

    test('should update location of a member in a room with multiple members', async ({ database }) => {
        let openerMsg = [], joinerMsg = [];
        const roomOpener = new RoomMember(database, { send: m => openerMsg.push(JSON.parse(m)), terminate: vi.fn() });
        const roomJoiner = new RoomMember(database, { send: m => joinerMsg.push(JSON.parse(m)), terminate: vi.fn() });

        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.roomId, 1, 1);

        await roomOpener.updateLocation(2, 2);
        await expect.poll(() => joinerMsg).toContainEqual({
            type: 'location', userId: roomOpener.id, lat: 2, lng: 2, time: expect.any(Object)
        });

        await roomJoiner.updateLocation(3, 3);
        await expect.poll(() => openerMsg).toContainEqual({
            type: 'location', userId: roomJoiner.id, lat: 3, lng: 3, time: expect.any(Object)
        });

        await roomOpener.leaveRoom();
        await roomJoiner.leaveRoom();
    });

    test('should update meeting point', async ({ database }) => {
        const roomOpener = new RoomMember(database, { send: vi.fn(), terminate: vi.fn() });
        await roomOpener.createRoom(0, 0);
        await roomOpener.updateMeetingPoint(1, 1);
        const infoDoc = await database.doc(`${roomOpener.roomId}/info`).get();
        expect(infoDoc.data()).toMatchObject({
            meetingPoint: new GeoPoint(1, 1)
        });
        await roomOpener.leaveRoom();
    });

    test('should propose meeting point', { timeout: 3000 }, async ({ database }) => {
        const openerMessages = [], joinerMessages = [];
        const roomOpener = new RoomMember(database, { send: m => openerMessages.push(JSON.parse(m)), terminate: vi.fn() });
        const roomJoiner = new RoomMember(database, { send: m => joinerMessages.push(JSON.parse(m)), terminate: vi.fn() });
        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.roomId, 1, 1);
        const meetingPoint = new GeoPoint(1, 1);
        await roomOpener.proposeMeetingPoint(meetingPoint.latitude, meetingPoint.longitude);
        await expect.poll(() => joinerMessages.some(m => m.type === 'info'
            && m.proposedMeetingPoint
            && meetingPoint
            && m.proposedMeetingPoint._latitude === meetingPoint.latitude
            && m.proposedMeetingPoint._longitude === meetingPoint.longitude) && openerMessages.some(m => m.type === 'info'
                && m.proposedMeetingPoint
                && meetingPoint
                && m.proposedMeetingPoint._latitude === meetingPoint.latitude
                && m.proposedMeetingPoint._longitude === meetingPoint.longitude)).toBeTruthy();
        await roomOpener.leaveRoom();
        await roomJoiner.leaveRoom();
    });
});
