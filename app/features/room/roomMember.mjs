import {
    Firestore,
    FieldValue,
    GeoPoint
} from 'firebase-admin/firestore';

import {
    LatitudeError,
    LatitudeRequiredError,
    LongitudeError,
    LongitudeRequiredError,
    RoomIdError,
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
     * The unsubscribe function for a rooms info document snapshot listener.
     */
    infoDocUnsubscribe = undefined;

    /**
 * A hashmap that contains all onSnapshot listeners for other room members.
 * This is used to keep track of location changes of other members in the room.
 * @type {Map<string, Unsubscribe>}
 * @memberof RoomMember
 */
    #locationUnsubscribes = new Map();

    /**
     * The unique identifier for the room this member belongs to
     * @type {string}
     * @memberof RoomMember
     */
    roomId;

    /**
     * The unique identifier for this room member.
     * @type {string}
     * @memberof RoomMember
     */
    id;

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
        this.roomId = undefined;
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
            const snapshot = await this.#firestoreDatabase.collection(`${this.roomId}/${this.id}/locations`).limit(batchSize).get();
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
        if (!this.roomId || !this.id) return;
        const infoRef = this.#firestoreDatabase.doc(`${this.roomId}/info`);
        if (this.roomUnsubscribe) this.roomUnsubscribe();
        if (this.infoDocUnsubscribe) this.infoDocUnsubscribe();
        this.#locationUnsubscribes.forEach(unsubscribe => unsubscribe());
        await this.#firestoreDatabase.runTransaction(async transaction => {
            const infoDoc = await transaction.get(infoRef);
            if (!infoDoc.exists) throw new Error('Room does not exist');
            await this.#deleteLocations();
            const memberCount = infoDoc.data().memberCount;
            if (memberCount <= 1) {
                transaction.delete(infoRef);
            } else {
                transaction.update(infoRef, { memberCount: memberCount - 1 });
            }
            transaction.delete(this.#firestoreDatabase.doc(`${this.roomId}/${this.id}`));
        });
        this.ws.send(JSON.stringify({
            type: 'left',
            userId: this.id
        }));
        this.roomUnsubscribe = undefined;
        this.infoDocUnsubscribe = undefined;
        this.#locationUnsubscribes.clear();
        this.roomId = undefined;
        this.id = undefined;
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
        if (this.roomId) throw new UserInRoomError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < - 90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < - 180 || lng > 180) throw new LongitudeError();
        this.roomId = roomId;
        const infoRef = this.#firestoreDatabase.doc(`${this.roomId}/info`);
        try {
            await this.#firestoreDatabase.runTransaction(async transaction => {
                const infoDoc = await transaction.get(infoRef);
                if (!infoDoc.exists) throw new Error('Room does not exist');
                transaction.update(infoRef, { memberCount: infoDoc.data().memberCount + 1 });
                const clientFields = { joinedAt: FieldValue.serverTimestamp(), lost: false, acceptedMeetingPoint: 0 };
                const memberDoc = this.#firestoreDatabase.collection(this.roomId).doc();
                transaction.set(memberDoc, clientFields);
                this.id = memberDoc.id;
                transaction.set(this.#firestoreDatabase.collection(`${this.roomId}/${this.id}/locations`).doc(), {
                    lat,
                    lng,
                    time: FieldValue.serverTimestamp()
                });
            });
        } catch (error) {
            console.error(`Join transaction failed for user ${this.id}:`, error);
        }
        this.roomUnsubscribe = this.#createRoomSnapshotListener();
        this.infoDocUnsubscribe = this.#createInfoDocSnapshotListener();
    }

    /**
     * Creates a new room.
     * @param {number} lat 
     * @param {number} lng 
     */
    async createRoom(lat, lng) {
        if (this.roomId) throw new UserInRoomError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < - 90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < - 180 || lng > 180) throw new LongitudeError();
        const alphanumericCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let success = false, attempts = 0, infoDoc;
        await this.#firestoreDatabase.runTransaction(async transaction => {
            while (!success && attempts < 10) {
                this.roomId = Array.from({ length: 4 }, () => alphanumericCharacters[Math.floor(Math.random() * alphanumericCharacters.length)]).join('');
                infoDoc = await transaction.get(this.#firestoreDatabase.doc(`${this.roomId}/info`));
                success = !infoDoc.exists;
                attempts++;
            }
            if (!success) throw new Error('Failed to create room after 10 attempts');
            transaction.set(infoDoc.ref, { createdAt: FieldValue.serverTimestamp(), memberCount: 1, meetingPoint: null, proposedMeetingPoint: null });
            const clientFields = { joinedAt: FieldValue.serverTimestamp(), lost: false, acceptedMeetingPoint: 0 };
            const memberDoc = this.#firestoreDatabase.collection(this.roomId).doc();
            transaction.set(memberDoc, clientFields);
            this.id = memberDoc.id;
            const locDoc = this.#firestoreDatabase.collection(`${this.roomId}/${this.id}/locations`).doc();
            const locDocTime = FieldValue.serverTimestamp();
            transaction.set(locDoc, {
                lat,
                lng,
                time: locDocTime
            });
        });
        const snap = await this.#firestoreDatabase.collection(`${this.roomId}/${this.id}/locations`).get();
        this.roomUnsubscribe = this.#createRoomSnapshotListener();
        this.infoDocUnsubscribe = this.#createInfoDocSnapshotListener();
        this.ws.send(JSON.stringify({
            type: 'created',
            roomId: this.roomId,
            userId: this.id
        }));
    }

    /**
     * Propose a new meeting point for the room.
     */
    async proposeMeetingPoint(lat, lng) {
        if (!this.roomId) throw new RoomIdError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < - 90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < - 180 || lng > 180) throw new LongitudeError();
        return this.#firestoreDatabase.doc(`${this.roomId}/info`).update({
            proposedMeetingPoint: new GeoPoint(lat, lng)
        });
    }

    /**
     * Updates the meeting point of the room.
     * @param {number} lat The latitude of the meeting point
     * @param {number} lng The longitude of the meeting point
     * @returns {Promise<FirebaseFirestore.WriteResult>}
     */
    async updateMeetingPoint(lat, lng) {
        if (!this.roomId) throw new RoomIdError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < - 90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < - 180 || lng > 180) throw new LongitudeError();
        return this.#firestoreDatabase.doc(`${this.roomId}/info`).update({
            meetingPoint: new GeoPoint(lat, lng)
        });
    }

    #createInfoDocSnapshotListener() {
        if (!this.roomId) throw new RoomIdError();
        return this.#firestoreDatabase.doc(`${this.roomId}/info`).onSnapshot(infoSnap => {
            const data = infoSnap.data();
            if (infoSnap.exists) {
                this.ws.send(JSON.stringify({
                    type: 'info',
                    createdAt: data.createdAt,
                    memberCount: data.memberCount,
                    meetingPoint: data.meetingPoint,
                    proposedMeetingPoint: data.proposedMeetingPoint
                }));
            }
        });
    }

    /**
     * Creates a snapshot listener for the room this member belongs to.
     * @private
     * @memberof RoomMember
     * @returns {Promise<Unsubscribe>}
     */
    #createRoomSnapshotListener() {
        return this.#firestoreDatabase.collection(this.roomId).onSnapshot(snap => {
            snap.docChanges().forEach(async ({ type, doc }) => {
                if (type === 'added' && doc.id !== this.id && doc.id !== 'info') {
                    this.#locationUnsubscribes.set(doc.id, doc.ref.collection('locations').orderBy('time', 'desc').limit(1).onSnapshot(locationSnap => {
                        if (!locationSnap.empty) {
                            const newLocation = locationSnap.docs[0].data();
                            this.ws.send(JSON.stringify({
                                type: 'location',
                                userId: doc.id,
                                lat: newLocation.lat,
                                lng: newLocation.lng,
                                time: newLocation.time
                            }));
                        }
                    }));
                    const newMemberLocation = (await doc.ref.collection('locations').orderBy('time', 'desc').limit(1).get()).docs[0].data();
                    this.ws.send(JSON.stringify({
                        type: 'location',
                        userId: doc.id,
                        lat: newMemberLocation.lat,
                        lng: newMemberLocation.lng,
                        time: newMemberLocation.time
                    }));
                } else if (type === 'removed' && doc.id !== 'info') {
                    this.ws.send(JSON.stringify({
                        type: 'left',
                        userId: doc.id
                    }));
                }
            });
        });
    }

    /**
     * Updates the location of the room member,
     * @memberof RoomMember
     * @returns {Promise<void>}
     */
    async updateLocation(lat, lng) {
        if (!this.roomId || !this.id) throw new UserInRoomError();
        if (lat === undefined || lat === null) throw new LatitudeRequiredError();
        if (lng === undefined || lng === null) throw new LongitudeRequiredError();
        if (typeof lat !== 'number' || lat < - 90 || lat > 90) throw new LatitudeError();
        if (typeof lng !== 'number' || lng < - 180 || lng > 180) throw new LongitudeError();
        await this.#firestoreDatabase.collection(`${this.roomId}/${this.id}/locations`).doc().set({
            lat,
            lng,
            time: FieldValue.serverTimestamp()
        });
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