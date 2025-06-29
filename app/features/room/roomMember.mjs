
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { Room } from './room.mjs';

import {
    LatitudeError,
    LatitudeRequiredError,
    LongitudeError,
    LongitudeRequiredError,
    RoomIdRequiredError,
    UserInRoomError,
    WebSocketError
} from '../server/errors.mjs';
import { WebSocket } from 'ws';

export class RoomMember {
    /**
     * @typedef {import("firebase/firestore").Unsubscribe} Unsubscribe
     */

    /**
     * The main Firestore database instance responsible for all rooms
     * @private
     * @memberof RoomMember
     * @type {Firestore}
     */
    #firestoreDatabase;

    /**
     * The WebSocket instance for this room member
     * @memberof RoomMember
     * @type {WebSocket}
     */
    ws;

    /**
     * The timeout to check if the room member is still alive.
     */
    heartbeatTimeout;

    /**
     * The unsubscribe function for the room member's room snapshot listener.
     * This is used to stop listening to changes in the room's data.
     * It is is undefined if the room member is not in a room.
     * @type {Unsubscribe | undefined}
     * @memberof RoomMember
     */
    roomUnsubscribe;

    /**
 * A hashmap that contains all onSnapshot listeners for other room members.
 * This is used to keep track of location changes of other members in the room.
 * @type {Map<string, Unsubscribe>}
 * @memberof RoomMember
 */
    #locationUnsubscribes = new Map();

    /**
     * A map to store data of other room members.
     * @private
     * @type {Map<string, FirebaseFirestore.DocumentData>}
     * @memberof RoomMember
     */
    #otherMembersData = new Map();


    /**
     * The Room instance this member belongs to.
     * @type {Room | undefined}
     */
    room = undefined;

    /**
     * The unique identifier for this room member.
     * @type {string}
     * @memberof RoomMember
     */
    id;


    get locationRef() {
        if (!this.room || !this.id) throw new Error('Not in a room');
        return this.#firestoreDatabase.collection(`${this.room.id}/${this.id}/locations`);
    }

    /**
     * Creates an instance of RoomMember.
     * @param {Firestore} firestoreDatabase 
     * @param {WebSocket} webSocket
     * @throws {Error} If firestoreDatabase or webSocket is not provided
     */
    constructor(firestoreDatabase, webSocket) {
        if (!firestoreDatabase) throw new Error('Firestore database is required');
        if (!webSocket) throw new WebSocketError();
        this.#firestoreDatabase = firestoreDatabase;
        this.ws = webSocket;
        this.id = undefined;
        this.roomUnsubscribe = undefined;
        this.checkAlive();
    }

    /**
     * Deletes all documents in a Firestore collection.
     * @param {FirebaseFirestore.CollectionReference} collectionRef - The Firestore collection reference.
     * @param {number} batchSize - The number of documents to delete in each batch. Default is 100. The batch size must be between 1 and 500.
     * @returns {Promise<void>} A promise that resolves when all documents are deleted.
     * @throws If the collection reference is not provided
     * @throws If the batch size is less than 1 or greater than 500
     */
    async #deleteLocations(batchSize = 100) {
        if (batchSize < 1 || batchSize > 500) throw new Error('Batch size must be between 1 and 500');

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const snapshot = await this.locationRef.limit(batchSize).get();
            if (snapshot.empty) break;
            const batch = this.#firestoreDatabase.batch();
            snapshot.docs.forEach(location => batch.delete(location.ref));
            await batch.commit();
            if (snapshot.size < batchSize) break;
        }
    }

    /**
     * This function should be used to leave a room. It returns the reference to the rooms info document.
     * With this reference, the server can check if all members have left the room and delete the room if it is empty.
     * @throws {UserInRoomError} If the user is not in a room
     * @throws {Error} If the user ID is not set
     * @memberof RoomMember
     */
    async leaveRoom() {
        if (!this.room || !this.id) return;
        if (this.roomUnsubscribe) {
            this.roomUnsubscribe();
            this.roomUnsubscribe = undefined;
        }
        this.#locationUnsubscribes.forEach(unsubscribe => unsubscribe());
        await this.#firestoreDatabase.runTransaction(async transaction => {
            const infoDoc = await transaction.get(this.room.infoRef);
            if (!infoDoc.exists) throw new Error('Room does not exist');
            await this.#deleteLocations();
            if ((await this.room.collection.count().get()).data().count <= 2) {
                transaction.delete(this.room.infoRef);
            }
            transaction.delete(this.#firestoreDatabase.doc(`${this.room.id}/${this.id}`));
        });
        this.#sendLeft();
        this.#locationUnsubscribes.clear();
        this.#otherMembersData.clear();
        this.room = undefined;
        this.id = undefined;
    }

    #sendLeft(id = this.id) {
        this.ws.send(JSON.stringify({
            type: 'left',
            userId: id
        }));
    }

    /**
     * Adds the room member to a room
     * @param {string} roomId The ID of the room to join
     * @param {lat} lat The latitude of the room member's location
     * @param {lng} lng The longitude of the room member's location
     * @throws {UserInRoomError} If the user is already in a room
     * @throws {LatitudeRequiredError} If latitude is not provided
     * @throws {LongitudeRequiredError} If longitude is not provided
     * @throws {LatitudeError} If latitude is not a number or out of range
     * @throws {LongitudeError} If longitude is not a number or out of range
     */
    async joinRoom(roomId, lat, lng) {
        if (this.room) throw new UserInRoomError();
        if (!roomId || roomId.trim() === '') throw new RoomIdRequiredError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < -90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < -180 || lng > 180) throw new LongitudeError();
        const room = await Room.get(this.#firestoreDatabase, roomId);
        const clientFields = { joinedAt: FieldValue.serverTimestamp(), lost: false };
        await this.#firestoreDatabase.runTransaction(async transaction => {
            const infoDoc = await transaction.get(room.infoRef);
            if (!infoDoc.exists) throw new Error('Room does not exist');
            const memberDoc = room.collection.doc();
            transaction.set(memberDoc, clientFields);
            this.id = memberDoc.id;
            transaction.set(memberDoc.collection(`locations`).doc(), {
                lat,
                lng,
                time: FieldValue.serverTimestamp()
            });
        });
        this.room = room;
        this.roomUnsubscribe = this.#createRoomSnapshotListener();
    }

    /**
     * Creates a new room.
     * @param {number} lat 
     * @param {number} lng 
     */
    async createRoom(lat, lng) {
        if (this.room) throw new UserInRoomError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < -90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < -180 || lng > 180) throw new LongitudeError();
        const { room, memberId } = await Room.create(this.#firestoreDatabase, lat, lng);
        this.room = room;
        this.id = memberId;
        this.roomUnsubscribe = this.#createRoomSnapshotListener();
        this.ws.send(JSON.stringify({
            type: 'created',
            roomId: room.id,
            userId: this.id
        }));
    }

    /**
     * Creates a snapshot listener for the room this member belongs to.
     * @private
     * @memberof RoomMember
     * @returns {Promise<Unsubscribe>}
     */
    #createRoomSnapshotListener() {
        if (!this.room) throw new Error('Not in a room');
        return this.room.collection.onSnapshot(snap => {
            for (const { type, doc } of snap.docChanges()) {
                const id = doc.id;
                const data = doc.data();
                if (id === this.id) continue;
                if (id === 'info') {
                    this.ws.send(JSON.stringify({
                        type: 'roomUpdate',
                        roomId: this.room.id,
                        proposals: data.proposals
                    }));
                    continue;
                }
                switch (type) {
                    case 'added':
                        this.#otherMembersData.set(id, data);
                        this.#sendMemberUpdate(id, data);
                        this.#locationUnsubscribes.set(id, doc.ref.collection('locations').orderBy('time', 'desc').limit(1).onSnapshot(locSnap => {
                            if (!locSnap.empty) {
                                const { lat, lng, time } = locSnap.docs[0].data();
                                this.ws.send(JSON.stringify({ type: 'location', userId: id, lat, lng, time }));
                            }
                        }));
                        break;
                    case 'modified':
                        const oldData = this.#otherMembersData.get(id);
                        if (oldData?.lost !== data.lost) {
                            this.#sendMemberUpdate(id, data);
                        }
                        this.#otherMembersData.set(id, data);
                        break;
                    case 'removed':
                        this.#sendLeft(id);
                        this.#locationUnsubscribes.get(id)?.();
                        this.#locationUnsubscribes.delete(id);
                        this.#otherMembersData.delete(id);
                        break;
                }
            }
        });
    }

    /**
     * Updates the location of the room member,
     * @memberof RoomMember
     * @returns {Promise<void>}
     */
    async updateLocation(lat, lng) {
        if (!this.room || !this.id) throw new UserInRoomError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < -90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < -180 || lng > 180) throw new LongitudeError();
        await this.locationRef.doc().set({
            lat,
            lng,
            time: FieldValue.serverTimestamp()
        });
    }

    /**
     * Proposes a meeting location to other room members.
     * Only one proposal per member at a time.
     * @param {import('firebase-admin/firestore').GeoPoint} geoPoint
     * @returns {Promise<void>}
     */
    async proposeMeetingPoint(geoPoint) {
        return this.#firestoreDatabase.runTransaction(async t => {
            if (!this.room || !this.id) throw new UserInRoomError();
            if (!geoPoint || !(geoPoint instanceof Firestore.GeoPoint)) {
                throw new Error('Invalid GeoPoint provided');
            }
            t.update(this.room.infoRef, {
                [`proposals.${this.id}`]: {
                    location: geoPoint,
                    acceptedBy: []
                }
            })
        });
    }

    /**
     * Accepts a proposed location from another member. Only one accepted at a time.
     * @param {string} proposerId - The userId of the member whose proposal to accept
     * @returns {Promise<void>}
     */
    async acceptMeetingPoint(proposerId) {
        return this.#firestoreDatabase.runTransaction(async t => {
            if (!proposerId || typeof proposerId !== 'string') {
                throw new Error('Invalid proposerId provided');
            }
            t.update(this.room.infoRef, {
                [`proposals.${proposerId}.acceptedBy`]: FieldValue.arrayUnion(this.id)
            });
        });
    }

    /**
     * Withdraws the acceptance of another member's proposed location.
     * @param {string} proposerId - The userId of the member whose proposal to withdraw acceptance from
     * @returns {Promise<void>}
     * @memberof RoomMember
     */
    async revokeMeetingPointAcceptance(proposerId) {
        return this.#firestoreDatabase.runTransaction(async t => {
            if (!proposerId || typeof proposerId !== 'string') {
                throw new Error('Invalid proposerId provided');
            }
            t.update(this.room.infoRef, {
                [`proposals.${proposerId}.acceptedBy`]: FieldValue.arrayRemove(this.id)
            });
        });
    }

    /**
     * Clears the member's own proposed location.
     * @returns {Promise<void>}
     */
    async deleteProposedMeetingPoint() {
        return this.#firestoreDatabase.runTransaction(async t => {
            t.update(this.room.infoRef, {
                [`proposals.${this.id}`]: FieldValue.delete()
            });
        });
    }

    #sendMemberUpdate(memberId, data) {
        this.ws.send(JSON.stringify({
            type: 'memberUpdate',
            userId: memberId,
            ...data
        }));
    }

    checkAlive() {
        this.ws.send(JSON.stringify({ type: 'ping' }));
        clearTimeout(this.heartbeatTimeout);
        this.heartbeatTimeout = setTimeout(async () => {
            await this.leaveRoom();
            this.ws.terminate();
        }, 30000);
    }
}