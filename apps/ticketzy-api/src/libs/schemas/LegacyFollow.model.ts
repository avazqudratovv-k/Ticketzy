import { Schema } from 'mongoose';

/**
 * Follows were removed from the API (#122). The `follows` collection and its old documents stay in the database untouched;
 * this schema exists only so `reset:demo` can delete the follow records an earlier `seed:demo` created (through the manifest).
 * It is registered by `demo-app.ts` alone, never by the API, and it creates no indexes.
 */
const LegacyFollowSchema = new Schema({}, { strict: false, collection: 'follows', autoIndex: false });

export default LegacyFollowSchema;
