import { describe, expect } from "vitest";
import { test } from "./serverTestUtils.mjs";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";
import { time } from "console";

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
        await expect.poll(() => websocketJoiner.messages).toContainEqual({
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
        await expect.poll(() => websocketOpener.messages).toContainEqual({
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

    test('should notify other members if one members location changes', async ({ websocketJoiner, websocketOpener }) => {
        const location = new GeoPoint(2, 2);
        websocketOpener.send(JSON.stringify({ type: 'create', lat: 0, lng: 0 }));
        const [roomId, userId] = await new Promise(resolve => {
            websocketOpener.on('message', message => {
                const data = JSON.parse(message);
                if (data.type === 'created') {
                    resolve([data.roomId, data.userId]);
                }
            });
        });
        websocketJoiner.send(JSON.stringify({ type: 'join', roomId, lat: 1, lng: 1 }));
        websocketOpener.send(JSON.stringify({ type: 'location', lat: location.latitude, lng: location.longitude }));
        await expect.poll(() => websocketJoiner.messages).toContainEqual({
            type: 'location',
            userId: userId,
            lat: location.latitude,
            lng: location.longitude,
            time: expect.any(Object)
        });
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

    test('should remove a member from a room', async ({ roomOpener, database }) => {
        await roomOpener.createRoom(0, 0);
        let openerDoc = await roomOpener.getDoc();
        const roomId = roomOpener.getRoomId();
        await roomOpener.leaveRoom();
        await expect.poll(() => roomOpener.messages).toContainEqual({ type: 'left', userId: openerDoc.id });
        openerDoc = await database.doc(`${roomId}/${openerDoc.id}`).get();
        expect(openerDoc.exists).toBe(false);
    });

    test('Remove member from room after 30s of inactivity', { timeout: 34000 }, async ({ roomOpener, database }) => {
        await roomOpener.createRoom(0, 0);
        const roomId = roomOpener.getRoomId();
        const id = roomOpener.id;
        await expect.poll(() => roomOpener.messages, { timeout: 32000, interval: 500 }).toContainEqual({
            type: 'left',
            userId: roomOpener.getId()
        });
        const openerDoc = await database.doc(`${roomId}/${id}`).get();
        expect(openerDoc.exists).toBe(false);
    });

    test('should notify members when another member joins a room', async ({ roomOpener, roomJoiner }) => {
        const openerLocation = new GeoPoint(0, 0);
        await roomOpener.createRoom(openerLocation.latitude, openerLocation.longitude);
        const roomId = roomOpener.getRoomId();

        await roomJoiner.joinRoom(roomId, 1, 1);
        expect(roomJoiner.getRoomId()).toBe(roomId);

        await expect.poll(() => roomJoiner.messages).toContainEqual({
            type: 'memberUpdate',
            userId: roomOpener.getId(),
            joinedAt: expect.any(Object),
            lost: false
        });

        await expect.poll(() => roomOpener.messages).toContainEqual({
            type: 'memberUpdate',
            userId: roomJoiner.getId(),
            joinedAt: expect.any(Object),
            lost: false
        });
    });

    test('should remove a second member from a room', async ({ roomJoiner, roomOpener, database }) => {
        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        const joinerDoc = await roomJoiner.getDoc();
        expect(joinerDoc.exists).toBe(true);
        const roomId = roomOpener.getRoomId();
        expect((await roomJoiner.getLocations()).docs).toHaveLength(1);
        await roomJoiner.leaveRoom();
        await expect.poll(() => roomJoiner.messages).toContainEqual({ type: 'left', userId: joinerDoc.id });
        await expect.poll(() => roomOpener.messages).toContainEqual({ type: 'left', userId: joinerDoc.id });
        expect((await database.doc(`${roomId}/${joinerDoc.id}`).get()).exists).toBeFalsy();
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

    test('should update info document if a member proposes a meeting point', async ({ roomOpener, database }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        const doc = await database.doc(`${roomOpener.getRoomId()}/info`).get();
        expect(doc.data().proposals[roomOpener.getId()]).toMatchObject({
            location: geoPoint,
            acceptedBy: []
        });
    });

    test('should notify other members if a member proposes a meeting point', async ({ roomOpener, roomJoiner }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        const expectedMessage = {
            type: 'roomUpdate',
            roomId: roomOpener.getRoomId(),
            proposals: {
                [roomOpener.getId()]: {
                    location: geoPoint,
                    acceptedBy: []
                }
            }
        };
        await expect.poll(() => roomJoiner.messages).toContainEqual(expectedMessage);
        await expect.poll(() => roomOpener.messages).toContainEqual(expectedMessage);
    });

    test('should update info document if a member accepts a meeting point', async ({ roomOpener, roomJoiner, database }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        await roomJoiner.acceptMeetingPoint(roomOpener.getId());
        const doc = await database.doc(`${roomOpener.getRoomId()}/info`).get();
        expect(doc.data().proposals[roomOpener.getId()]).toMatchObject({
            location: geoPoint,
            acceptedBy: [roomJoiner.getId()]
        });
    });

    test('should notify other members if a member accepts a meeting point', async ({ roomOpener, roomJoiner }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        await roomJoiner.acceptMeetingPoint(roomOpener.getId());
        const expectedMessage = {
            type: 'roomUpdate',
            roomId: roomOpener.getRoomId(),
            proposals: {
                [roomOpener.getId()]: {
                    location: geoPoint,
                    acceptedBy: [roomJoiner.getId()]
                }
            }
        };
        await expect.poll(() => roomJoiner.messages).toContainEqual(expectedMessage);
        await expect.poll(() => roomOpener.messages).toContainEqual(expectedMessage);
    });

    test('should delete proposed meeting point', async ({ roomOpener, database }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        await roomOpener.deleteProposedMeetingPoint();
        const doc = await database.doc(`${roomOpener.getRoomId()}/info`).get();
        expect(doc.data().proposals[roomOpener.getId()]).toBeUndefined();
    });

    test('should notify other members if a member deletes a proposed meeting point', async ({ roomOpener, roomJoiner }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        await roomOpener.deleteProposedMeetingPoint();
        const expectedMessage = {
            type: 'roomUpdate',
            roomId: roomOpener.getRoomId(),
            proposals: {
                [roomOpener.getId()]: undefined
            }
        };
        await expect.poll(() => roomJoiner.messages).toContainEqual(expectedMessage);
        await expect.poll(() => roomOpener.messages).toContainEqual(expectedMessage);
    });

    test('should revoke acceptance of a proposed meeting point', async ({ roomOpener, roomJoiner, database }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        await roomJoiner.acceptMeetingPoint(roomOpener.getId());
        await roomJoiner.revokeMeetingPointAcceptance(roomOpener.getId());
        const doc = await database.doc(`${roomOpener.getRoomId()}/info`).get();
        expect(doc.data().proposals[roomOpener.getId()]).toMatchObject({
            location: geoPoint,
            acceptedBy: []
        });
    });

    test('should notify others if a member revokes meeting point acceptance', async ({ roomOpener, roomJoiner }) => {
        await roomOpener.createRoom(0, 0);
        const geoPoint = new GeoPoint(5, 10);
        await roomOpener.proposeMeetingPoint(geoPoint);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        const expected = {
            type: 'roomUpdate',
            roomId: roomOpener.getRoomId(),
            proposals: {
                [roomOpener.getId()]: { location: geoPoint, acceptedBy: [] }
            }
        };
        await expect.poll(() => roomJoiner.messages.pop()).toEqual(expected);
        await roomJoiner.acceptMeetingPoint(roomOpener.getId());
        await roomJoiner.revokeMeetingPointAcceptance(roomOpener.getId());
        await expect.poll(() => roomJoiner.messages.pop()).toEqual(expected);
    });
});
