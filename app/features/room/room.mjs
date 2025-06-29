import { FieldValue } from 'firebase-admin/firestore';

export class Room {
    /**
     * @param {import('firebase-admin/firestore').Firestore} firestore
     * @param {string} id
     * @param {Map<string, any>} info
     */
    constructor(firestore, id, info = new Map()) {
        this.firestore = firestore;
        this.id = id;
        this.info = info;
    }

    /**
     * Creates a new room with a unique 4-character ID and adds the first member.
     * @param {import('firebase-admin/firestore').Firestore} firestore
     * @param {object} memberFields
     * @param {number} lat
     * @param {number} lng
     * @returns {Promise<{ room: Room, memberId: string }>}
     */
    static async create(firestore, lat, lng) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let success = false, attempts = 0, infoDoc, roomId;
        let memberId;
        let infoFields;
        await firestore.runTransaction(async transaction => {
            while (!success && attempts < 10) {
                roomId = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
                infoDoc = await transaction.get(firestore.doc(`${roomId}/info`));
                success = !infoDoc.exists;
                attempts++;
            }
            if (!success) throw new Error('Failed to create room after 10 attempts');
            const memberDoc = firestore.collection(roomId).doc();
            infoFields = {
                createdAt: FieldValue.serverTimestamp(),
                members: [memberDoc.id]
            };
            transaction.set(infoDoc.ref, infoFields);
            transaction.set(memberDoc, { joinedAt: FieldValue.serverTimestamp(), lost: false });
            memberId = memberDoc.id;
            transaction.set(firestore.collection(`${roomId}/${memberId}/locations`).doc(), {
                lat,
                lng,
                time: FieldValue.serverTimestamp()
            });
        });
        const infoMap = new Map(Object.entries(infoFields));
        infoMap.set('id', roomId);
        return { room: new Room(firestore, roomId, infoMap), memberId };
    }

    /**
     * Gets a Room instance for an existing room.
     * @param {import('firebase-admin/firestore').Firestore} firestore
     * @param {string} roomId
     * @returns {Promise<Room>}
     */
    static async get(firestore, roomId) {
        const infoRef = firestore.doc(`${roomId}/info`);
        const infoDoc = await infoRef.get();
        if (!infoDoc.exists) throw new Error('Room does not exist');
        const infoMap = new Map(Object.entries(infoDoc.data()));
        infoMap.set('id', roomId);
        return new Room(firestore, roomId, infoMap);
    }

    /**
     * Adds a member to the room.
     * @param {string} memberId
     * @returns {Promise<void>}
     */
    async addMember(memberId) {
        const infoRef = this.firestore.doc(`${this.id}/info`);
        await infoRef.update({ members: FieldValue.arrayUnion(memberId) });
    }

    /**
     * Removes a member from the room.
     * @param {string} memberId
     * @returns {Promise<void>}
     */
    async removeMember(memberId) {
        const infoRef = this.firestore.doc(`${this.id}/info`);
        await infoRef.update({ members: FieldValue.arrayRemove(memberId) });
    }

    /**
     * Deletes the room if it is empty.
     * @returns {Promise<void>}
     */
    async deleteIfEmpty() {
        const infoRef = this.firestore.doc(`${this.id}/info`);
        const infoDoc = await infoRef.get();
        if (!infoDoc.exists) return;
        const members = infoDoc.data().members;
        if (!members || members.length === 0) {
            await infoRef.delete();
        }
    }

    /**
     * Returns the info document as a Map.
     * @returns {Map<string, any>}
     */
    getInfo() {
        return this.info;
    }

    /**
     * Returns the Firestore collection reference for this room.
     */
    get collection() {
        return this.firestore.collection(this.id);
    }

    /**
     * Returns the info document reference for this room.
     */
    get infoRef() {
        return this.firestore.doc(`${this.id}/info`);
    }
}
