import fs from "fs";

export function getConfig() {
    if (process.env.NODE_ENV === 'development') {
        try {
            return JSON.parse(fs.readFileSync('./firebase.secret.json', 'utf8'));
        } catch (error) {
            console.error("Error reading firebase.secret.json:", error);
            process.exit(1);
        }
    } else {
        const env = process.env;
        const keys = [
            'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID',
            'FIREBASE_STORAGE_BUCKET', 'FIREBASE_MESSAGING_SENDER_ID',
            'FIREBASE_APP_ID', 'FIREBASE_DATABASE_ID'
        ];
        if (keys.some(k => !env[k])) {
            console.error("Missing Firebase environment variables");
            process.exit(1);
        }
        return {
            apiKey: env.FIREBASE_API_KEY,
            authDomain: env.FIREBASE_AUTH_DOMAIN,
            projectId: env.FIREBASE_PROJECT_ID,
            storageBucket: env.FIREBASE_STORAGE_BUCKET,
            messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
            appId: env.FIREBASE_APP_ID,
            databaseId: env.FIREBASE_DATABASE_ID
        };
    }
};
