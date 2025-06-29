import { describe, expect } from "vitest";
import { test } from "../server/serverTestUtils.mjs";
import { GeoPoint, Timestamp } from "firebase-admin/firestore";

describe('create room', () => {
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
});

describe('join room', () => {
    test('should join a room with correct data', async ({ roomOpener, roomJoiner }) => {
        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        const joinerDoc = await roomJoiner.getDoc();
        expect(joinerDoc.exists).toBe(true);
        expect(joinerDoc.data()).toMatchObject({
            lost: false,
            joinedAt: expect.any(Object)
        });
        expect(roomJoiner.getRoomId()).toBe(roomOpener.getRoomId());
        expect(roomJoiner.getId()).toBe(joinerDoc.id);
        const locations = await roomJoiner.getLocations();
        expect(locations.docs).toHaveLength(1);
        expect(locations.docs.map(doc => doc.data())).toContainEqual({
            lat: 1,
            lng: 1,
            time: expect.any(Object)
        });
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

    test('should send location of the room opener to the room joiner', async ({ roomOpener, roomJoiner }) => {
        const openerLocation = new GeoPoint(0, 0);
        await roomOpener.createRoom(openerLocation.latitude, openerLocation.longitude);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), 1, 1);
        await expect.poll(() => roomJoiner.messages).toContainEqual({
            type: 'location',
            userId: roomOpener.getId(),
            lat: openerLocation.latitude,
            lng: openerLocation.longitude,
            time: expect.any(Object)
        });
    });

    test('should send location of the room joiner to the room opener', async ({ roomOpener, roomJoiner }) => {
        const joinerLocation = new GeoPoint(1, 1);
        await roomOpener.createRoom(0, 0);
        await roomJoiner.joinRoom(roomOpener.getRoomId(), joinerLocation.latitude, joinerLocation.longitude);
        await expect.poll(() => roomOpener.messages).toContainEqual({
            type: 'location',
            userId: roomJoiner.getId(),
            lat: joinerLocation.latitude,
            lng: joinerLocation.longitude,
            time: expect.any(Object)
        });
    });
});

describe('Remove room member', () => {
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
});

describe("location", () => {
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
});

describe('meeting point', () => {
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