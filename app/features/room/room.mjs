import { FieldValue } from 'firebase-admin/firestore';

export class Room {
    /**
     * @param {import('firebase-admin/firestore').Firestore} firestore
     * @param {string} id
     * @param {Map<string, any>} info
     */
    constructor(firestore, id) {
        this.firestore = firestore;
        this.id = id;
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
                proposals: {},
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
        return { room: new Room(firestore, roomId), memberId };
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
        return new Room(firestore, roomId);
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
