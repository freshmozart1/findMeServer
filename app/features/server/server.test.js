import { describe, expect } from "vitest";
import { test } from "./serverTestUtils.mjs";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";

describe('server.mjs', () => {
    test('Client should open a WebSocket connection', ({ websocketOpener }) => {
        expect(websocketOpener.readyState).toBe(websocketOpener.OPEN);
    });

    test('should respond with a ping upon a pong', async ({ websocketOpener }) => {
        websocketOpener.send(JSON.stringify({ type: 'pong' }));
        await expect.poll(() => websocketOpener.messages.filter(msg => msg.type === 'ping').length).toBeGreaterThanOrEqual(2);
    });

    test('should respond with a created upon a create', async ({ websocketOpener }) => {
        const location = new GeoPoint(0, 0);
        websocketOpener.send(JSON.stringify({ type: 'create', lat: location.latitude, lng: location.longitude }));
        await expect.poll(() => websocketOpener.messages).toContainEqual({
            type: 'created',
            roomId: expect.any(String),
            userId: expect.any(String)
        });
    });

    test('should delete a room after all members left', async ({ websocketOpener, database }) => {
        websocketOpener.send(JSON.stringify({ type: 'create', lat: 0, lng: 0 }));
        const roomId = await new Promise(resolve => {
            websocketOpener.on('message', message => {
                const data = JSON.parse(message);
                if (data.type === 'created') {
                    resolve(data.roomId);
                }
            });
        });
        expect((await database.collection(roomId).count().get()).data().count).toBe(2);
        websocketOpener.close();
        await expect.poll(async () => (await database.collection(roomId).count().get()).data().count).toBe(0);
    });

    test('should respond with a location if a member joins', async ({ websocketOpener, websocketJoiner }) => {
        const location = new GeoPoint(1, 1);
        websocketOpener.send(JSON.stringify({ type: 'create', lat: 0, lng: 0 }));
        const roomId = await new Promise(resolve => {
            websocketOpener.on('message', message => {
                const data = JSON.parse(message);
                if (data.type === 'created') {
                    resolve(data.roomId);
                }
            });
        });
        websocketJoiner.send(JSON.stringify({ type: 'join', roomId, lat: location.latitude, lng: location.longitude }));
        await expect.poll(() => {
            console.log(websocketJoiner.messages);
            return websocketJoiner.messages;
        }).toContainEqual({
            type: 'location',
            userId: expect.any(String),
            lat: 0,
            lng: 0,
            time: expect.any(Object)
        });
    });

    test('should respond with a left message upon a leave message', async ({ websocketOpener }) => {
        websocketOpener.send(JSON.stringify({ type: 'create', lat: 0, lng: 0 }));
        await new Promise(resolve => {
            websocketOpener.on('message', message => {
                const data = JSON.parse(message);
                if (data.type === 'created') {
                    resolve();
                }
            });
        });
        websocketOpener.send(JSON.stringify({ type: 'leave' }));
        await expect.poll(() => {
            console.log(websocketOpener.messages);
            return websocketOpener.messages;
        }).toContainEqual({
            type: 'left',
            userId: expect.any(String)
        });
    });

    test('should update location upon receiving a location message', async ({ websocketOpener, database }) => {
        const location = new GeoPoint(1, 1);
        websocketOpener.send(JSON.stringify({ type: 'create', lat: 0, lng: 0 }));
        const [roomId, userId] = await new Promise(resolve => {
            websocketOpener.on('message', message => {
                const data = JSON.parse(message);
                if (data.type === 'created') {
                    resolve([data.roomId, data.userId]);
                }
            });
        });
        websocketOpener.send(JSON.stringify({ type: 'location', lat: location.latitude, lng: location.longitude }));
        await expect.poll(async () => (await database.collection(`${roomId}/${userId}/locations`).count().get()).data().count).toBe(2);
    });
});

describe("RoomMember.mjs", () => {

    test('should create a room with correct data', async ({ roomOpener }) => {
        const location = new GeoPoint(0, 0);
        await roomOpener.createRoom(location.latitude, location.longitude);
        expect(roomOpener.getRoomId()).toBeDefined();
        expect(roomOpener.getId()).toBeDefined();
        await expect.poll(() => roomOpener.messages).toContainEqual({
            type: 'created',
            roomId: roomOpener.getRoomId(),
            userId: roomOpener.getId()
        });
        const openerDoc = await roomOpener.getDoc();
        const locations = await roomOpener.getLocations();
        expect(openerDoc.exists).toBe(true);
        expect(locations.docs).toHaveLength(1);
        expect(locations.docs[0].data()).toMatchObject({
            lat: location.latitude,
            lng: location.longitude,
            time: expect.any(Object)
        });
    });

    test('should remove a member from a room', async ({ roomOpener }) => {
        await roomOpener.createRoom(0, 0);
        expect(roomOpener.getRoomId()).toBeDefined();
        expect(roomOpener.getId()).toBeDefined();
        let openerDoc = await roomOpener.getDoc();
        expect(openerDoc.exists).toBe(true);
        expect((await roomOpener.getLocations()).docs).toHaveLength(1);
        await roomOpener.leaveRoom();
        await expect.poll(() => roomOpener.messages).toContainEqual({ type: 'left', userId: openerDoc.id });
        openerDoc = await roomOpener.getDoc();
        expect(openerDoc.exists).toBe(false);
    });

    test('Remove member from room after 30s of inactivity', { timeout: 34000 }, async ({ roomOpener }) => {
        await roomOpener.createRoom(0, 0);
        await expect.poll(() => roomOpener.messages, { timeout: 32000, interval: 500 }).toContainEqual({
            type: 'left',
            userId: roomOpener.getId()
        });
        await expect(roomOpener.getDoc()).resolves.toMatchObject({
            exists: false
        });
    });

    test('should add a second member to a room', { timeout: 3000 }, async ({ roomOpener, roomJoiner }) => {
        const openerLocation = new GeoPoint(0, 0);
        await roomOpener.createRoom(openerLocation.latitude, openerLocation.longitude);
        expect(roomOpener.getRoomId()).toBeDefined();
        expect(roomOpener.getId()).toBeDefined();
        const openerDoc = await roomOpener.getDoc();
        expect(openerDoc.exists).toBe(true);
        expect((await roomOpener.getLocations()).docs).toHaveLength(1);

        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        expect(roomJoiner.getRoomId()).toBe(roomOpener.getRoomId());
        expect(roomJoiner.getId()).toBeDefined();
        const joinerDoc = await roomJoiner.getDoc();
        expect(joinerDoc.exists).toBe(true);
        expect((await roomJoiner.getLocations()).docs).toHaveLength(1);

        await expect.poll(() => roomJoiner.messages).toContainEqual({
            type: 'location',
            userId: roomOpener.getId(),
            lat: openerLocation.latitude,
            lng: openerLocation.longitude,
            time: expect.any(Object)
        });
    });

    test('should remove a second member from a room', async ({ roomJoiner, roomOpener }) => {
        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        const joinerDoc = await roomJoiner.getDoc();
        expect(joinerDoc.exists).toBe(true);
        expect((await roomJoiner.getLocations()).docs).toHaveLength(1);
        await roomJoiner.leaveRoom();
        await expect.poll(() => roomJoiner.messages).toContainEqual({ type: 'left', userId: joinerDoc.id });
        await expect.poll(() => roomOpener.messages).toContainEqual({ type: 'left', userId: joinerDoc.id });
        expect((await roomJoiner.getDoc()).exists).toBeFalsy();
    });

    test('should update location of a member in a room', async ({ roomOpener }) => {
        await roomOpener.createRoom(0, 0);
        const location = new GeoPoint(1, 1);
        await roomOpener.updateLocation(location.latitude, location.longitude);
        const locations = await roomOpener.getLocations();
        expect(locations.docs).toHaveLength(2);
        expect(locations.docs.map(doc => doc.data())).toContainEqual({
            lat: location.latitude,
            lng: location.longitude,
            time: expect.any(Timestamp)
        });
    });

    test('should notify other members of a location change', async ({ roomOpener, roomJoiner }) => {
        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);

        await roomOpener.updateLocation(2, 2);
        await expect.poll(() => roomJoiner.messages).toContainEqual({
            type: 'location',
            userId: roomOpener.getId(),
            lat: 2,
            lng: 2,
            time: expect.any(Object)
        });

        await roomJoiner.updateLocation(3, 3);
        await expect.poll(() => roomOpener.messages).toContainEqual({
            type: 'location',
            userId: roomJoiner.getId(),
            lat: 3,
            lng: 3,
            time: expect.any(Object)
        });
    });

    test('should propose meeting point', { timeout: 3000 }, async ({ roomOpener, roomJoiner }) => {
        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        const meetingPoint = new GeoPoint(1, 1);
        await roomOpener.proposeMeetingPoint(meetingPoint.latitude, meetingPoint.longitude);
        await expect.poll(() => roomJoiner.messages.some(jm => jm.type === 'info'
            && jm.proposedMeetingPoint
            && jm.proposedMeetingPoint._latitude === meetingPoint.latitude
            && jm.proposedMeetingPoint._longitude === meetingPoint.longitude)
            && roomOpener.messages.some(om => om.type === 'info'
                && om.proposedMeetingPoint
                && om.proposedMeetingPoint._latitude === meetingPoint.latitude
                && om.proposedMeetingPoint._longitude === meetingPoint.longitude)).toBeTruthy();
    });

    test('should accept a meeting point', async ({ roomOpener, database }) => {
        await roomOpener.createRoom(0, 0);
        await roomOpener.acceptMeetingPoint();
        expect((await roomOpener.getDoc()).data().acceptedMeetingPoint).toBe(1);
    });
});
