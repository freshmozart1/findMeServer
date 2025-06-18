import {
    collection,
    doc,
    CollectionReference,
    DocumentReference,
    Firestore,
    runTransaction,
    serverTimestamp,
    onSnapshot,
    getDocs,
    query,
    limit,
    writeBatch,
    getDoc
} from 'firebase/firestore';


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
     * A map of unsubscribe functions for location snapshot listeners of other room members.
     * This is used to stop listening to location changes of other room members.
     * @type {Object.<string, Unsubscribe> | {}}
     * @memberof RoomMember
     */
    locationUnsubscribeMap;

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
     * The collection reference for the room this member belongs to.
     * @type {CollectionReference}
     * @memberof RoomMember
     * @throws {RoomIdError} If roomId is not set
     */
    get roomRef() {
        if (!this.roomId) throw new RoomIdError();
        return collection(this.#firestoreDatabase, this.roomId);
    }

    /**
     * The document reference for the room member's specific document.
     * @type {DocumentReference}
     * @memberof RoomMember
     * @throws {RoomIdError} If roomId is not set
     */
    get ref() {
        if (!this.roomId) throw new RoomIdError();
        if (this.id) return doc(this.roomRef, this.id);
        else return doc(this.roomRef);
    }

    /**
     * The collection reference for the room member's locations.
     * @type {CollectionReference}
     * @memberof RoomMember
     */
    get locationRef() {
        return collection(this.#firestoreDatabase, this.roomId, this.id, 'locations');
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
        this.roomId = undefined;
        this.id = undefined;
        this.roomUnsubscribe = undefined;
        this.locationUnsubscribeMap = {};
        this.heartbeatTimeout = undefined;
    }

    /**
     * Deletes all documents in a Firestore collection.
     * @param {FirebaseFirestore.CollectionReference} collectionRef - The Firestore collection reference.
     * @param {number} batchSize - The number of documents to delete in each batch. Default is 100. The batch size must be between 1 and 500.
     * @returns {Promise<void>} A promise that resolves when all documents are deleted.
     * @throws If the collection reference is not provided
     * @throws If the batch size is less than 1 or greater than 500
     */
    async #deleteCollectionDocuments(batchSize = 100) {
        if (batchSize < 1 || batchSize > 500) throw new Error('Batch size must be between 1 and 500');

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const snapshot = await getDocs(query(this.locationRef, limit(batchSize)));
            if (snapshot.empty) break;
            const batch = writeBatch(this.#firestoreDatabase);
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
        if (!this.roomId) throw new Error('User is not in a room');
        if (!this.id) throw new Error('User ID is not set');
        const infoRef = doc(this.roomRef, 'info');
        Object.values(this.locationUnsubscribeMap).forEach(unsubscribe => unsubscribe());
        if (this.roomUnsubscribe) this.roomUnsubscribe();
        await runTransaction(this.#firestoreDatabase, async transaction => {
            const infoDoc = await transaction.get(infoRef);
            if (!infoDoc.exists()) throw new Error('Room does not exist');
            this.#deleteCollectionDocuments();
            const memberCount = infoDoc.data().memberCount;
            if (memberCount <= 1) {
                transaction.delete(infoRef);
            } else {
                transaction.update(infoRef, { memberCount: memberCount - 1 });
            }
            transaction.delete(this.ref);
        });
        this.ws.send(JSON.stringify({
            type: 'left',
            userId: this.id
        }));
        this.locationUnsubscribeMap = {};
        this.roomUnsubscribe = undefined;
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
        const infoRef = doc(this.roomRef, 'info');
        await runTransaction(this.#firestoreDatabase, async transaction => {
            const infoDoc = await transaction.get(infoRef);
            if (!infoDoc.exists()) throw new Error('Room does not exist');
            transaction.update(infoRef, { memberCount: infoDoc.data().memberCount + 1 });
            const clientFields = { joinedAt: serverTimestamp(), lost: false };
            this.id = this.ref.id;
            transaction.set(this.ref, clientFields);
            this.roomUnsubscribe = await this.#createRoomSnapshotListener();
            transaction.set(doc(collection(this.#firestoreDatabase, this.roomId, this.id, 'locations')), {
                lat,
                lng,
                time: serverTimestamp()
            });
        });
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
        let success = false, attempts = 0, infoRef;
        while (!success && attempts < 10) {
            this.roomId = Array.from({ length: 4 }, () => alphanumericCharacters[Math.floor(Math.random() * alphanumericCharacters.length)]).join('');
            infoRef = doc(this.roomRef, 'info');
            success = !(await getDoc(infoRef)).exists();
            attempts++;
        }
        if (!success) throw new Error('Failed to create room after 10 attempts');
        await runTransaction(this.#firestoreDatabase, async transaction => {
            transaction.set(infoRef, { createdAt: serverTimestamp(), memberCount: 1 });
            const clientFields = { joinedAt: serverTimestamp(), lost: false };
            this.id = this.ref.id;
            transaction.set(this.ref, clientFields);
            this.roomUnsubscribe = await this.#createRoomSnapshotListener();
            transaction.set(doc(collection(this.#firestoreDatabase, this.roomId, this.id, 'locations')), {
                lat,
                lng,
                time: serverTimestamp()
            });
        });
        this.ws.send(JSON.stringify({
            type: 'created',
            roomId: this.roomId,
            userId: this.id
        }));
    }

    /**
     * Creates a snapshot listener for the room this member belongs to.
     * @private
     * @memberof RoomMember
     * @returns {Promise<Unsubscribe>}
     */
    async #createRoomSnapshotListener() {
        return onSnapshot(this.roomRef, snap => {
            snap.docChanges().forEach(({ type, doc }) => {
                if (type === 'added' && doc.id !== this.id && doc.id !== 'info') {
                    this.locationUnsubscribeMap[doc.id] = onSnapshot(collection(this.#firestoreDatabase, this.roomId, doc.id, 'locations'), locSnap => locSnap.docChanges().forEach(({ type: lType, doc: lDoc }) => {
                        if (lType === 'added') {
                            const { lat, lng, time } = lDoc.data();
                            this.ws.send(JSON.stringify({
                                type: 'location',
                                roomId: this.roomId,
                                userId: doc.id,
                                lat,
                                lng,
                                time
                            }));
                        }
                    }));
                } else if (type === 'removed' && doc.id !== 'info') {
                    if (doc.id !== this.id) {
                        this.locationUnsubscribeMap[doc.id]();
                        delete this.locationUnsubscribeMap[doc.id];
                    }
                    this.ws.send(JSON.stringify({
                        type: 'left',
                        userId: doc.id
                    }));
                } else if (type === 'modified' && doc.id !== this.id && doc.id !== 'info' && doc.data().lost) this.ws.send(JSON.stringify({
                    type: 'lost',
                    userId: doc.id
                }));
            });
        });
    }
}