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