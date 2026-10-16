import { ObjectId } from 'bson';

export const availableOrganizerSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews', 'memberRank'];
export const availableMemberSorts = ['createdAt', 'updatedAt', 'memberLikes', 'memberViews'];
export const availableEventSorts = [
  'createdAt',
  'updatedAt',
  'eventLikes',
  'eventViews',
  'eventRank',
  'eventMinPrice',
  'startAt',
];
export const availableOrderSorts = ['createdAt', 'updatedAt', 'totalAmount'];
export const availableVenueSorts = ['createdAt', 'updatedAt', 'venueName', 'venueCapacity'];
export const availableCommentSorts= ['createdAt', 'updatedAt']
export const availableAuditLogSorts = ['createdAt']

/** IMAGE CONFIGURATION */
import { v4 as uuidv4 } from 'uuid';
import { createWriteStream, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Message } from './enums/common.enum';
import { MemberStatus } from './enums/member.enum';
import { T } from './types/common';

export const validUploadTargets = ['member', 'event', 'venue'];

/** the real file type is read from the first bytes, the client-sent filename and mimetype are never trusted */
const imageSignatures: { ext: string; signature: number[] }[] = [
	{ ext: '.png', signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
	{ ext: '.jpg', signature: [0xff, 0xd8, 0xff] },
];
const IMAGE_HEAD_BYTES = 8;

export const detectImageExtension = (head: Buffer): string | null => {
	const found = imageSignatures.find(({ signature }) => signature.every((byte, i) => head[i] === byte));
	return found ? found.ext : null;
};

/**
 * Streams an uploaded image to uploads/<target>/<uuid><ext>, where ext comes from the detected type.
 * Rejects (and writes nothing) when the content is not a png or jpeg.
 */
export const saveVerifiedImage = async (stream: Readable, target: string): Promise<string> => {
	const iterator = stream[Symbol.asyncIterator]();
	const chunks: Buffer[] = [];
	let size = 0;
	while (size < IMAGE_HEAD_BYTES) {
		const { value, done } = await iterator.next();
		if (done) break;
		chunks.push(Buffer.from(value));
		size += value.length;
	}

	const head = Buffer.concat(chunks);
	const ext = detectImageExtension(head);
	if (!ext) {
		stream.destroy();
		throw new Error(Message.PROVIDE_ALLOWED_FORMAT);
	}

	mkdirSync(`uploads/${target}`, { recursive: true });
	const url = `uploads/${target}/${uuidv4()}${ext}`;
	async function* withHead() {
		yield head;
		for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value;
	}

	try {
		await pipeline(Readable.from(withHead()), createWriteStream(url));
	} catch (err) {
		await unlink(url).catch(() => undefined);
		throw new Error(Message.UPLOAD_FAILED);
	}
	return url;
};

/**
 * All or nothing (#117): every file is verified and stored; if any one fails, the files this call already wrote are
 * removed and the first failure is thrown, so a rejected request leaves no orphan on disk. Order is kept.
 */
export const saveVerifiedImages = async (
	files: Promise<{ createReadStream: () => Readable }>[],
	target: string,
	save: (stream: Readable, target: string) => Promise<string> = saveVerifiedImage,
): Promise<string[]> => {
	const settled = await Promise.allSettled(
		files.map(async (file) => {
			const { createReadStream } = await file;
			return await save(createReadStream(), target);
		}),
	);
	const failure = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
	if (failure) {
		const written = settled.filter((entry): entry is PromiseFulfilledResult<string> => entry.status === 'fulfilled').map((entry) => entry.value);
		await Promise.all(written.map((url) => unlink(url).catch(() => undefined)));
		throw failure.reason;
	}
	return settled.map((entry) => (entry as PromiseFulfilledResult<string>).value);
};

/** user text must never reach new RegExp unescaped (regex injection / ReDoS) */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const shapeIntoMongoObjectId = (target: any) => {
	return typeof target === 'string' ? new ObjectId(target) : target;
};

export const lookupAuthMemberLiked = (memberId: T, targetRefId: string = '$_id') => {
  return {
    $lookup: {
      from: 'likes',
      let: {
        localLikeRefId: targetRefId,
        localMemberId: memberId,
        localMyFavorite: true,
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [{ $eq: ['$likeRefId', '$$localLikeRefId'] }, { $eq: ['$memberId', '$$localMemberId'] }],
            },
          },
        },
        {
          $project: {
            _id: 0,
            memberId: 1,
            likeRefId: 1,
            myFavorite: '$$localMyFavorite',
          },
        },
      ],
      as: 'meLiked',
    },
  };
};

interface LookupAuthMemberFollowed {
  followerId: T,
  followingId: string,
}
export const lookupAuthMemberFollowed = (input: LookupAuthMemberFollowed) => {
  const { followerId, followingId } = input;
  return {
    $lookup: {
      from: 'follows',
      let: {
        localFollowerId: followerId,
        localFollowingId: followingId,
        localMyFavorite: true,
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [{ $eq: ['$followerId', '$$localFollowerId'] }, { $eq: ['$followingId', '$$localFollowingId'] }],
            },
          },
        },
        {
          $project: {
            _id: 0,
            followerId: 1,
            followingId: 1,
            myFollowing: '$$localMyFavorite',
          },
        },
      ],
      as: 'meFollowed',
    },
  };
};



export const lookupMember = {
  $lookup: {
    from: 'members',
    localField: 'memberId',
    foreignField: '_id',
    as: 'memberData',
  }
};

export const lookupActor = {
  $lookup: {
    from: 'members',
    localField: 'actorId',
    foreignField: '_id',
    as: 'actorData',
  },
};

export const lookupFollowingData = {
    $lookup: {
        from: 'members',
        localField: 'followingId',
        foreignField: '_id',
        as: 'followingData',
    },
};

export const lookupFollowerData = {
    $lookup: {
        from: 'members',
        localField: 'followerId',
        foreignField: '_id',
        as: 'followerData',
    },
};

export const lookupOrganizer = {
  $lookup: {
    from: 'members',
    localField: 'organizerId',
    foreignField: '_id',
    as: 'memberData',
  },
};

export const lookupVenue = {
  $lookup: {
    from: 'venues',
    localField: 'venueId',
    foreignField: '_id',
    as: 'venueData',
  },
};

/** public event queries: attaches the organizer as memberData and drops events whose organizer is not ACTIVE */
export const lookupActiveOrganizer = [
  lookupOrganizer,
  { $unwind: '$memberData' },
  { $match: { 'memberData.memberStatus': MemberStatus.ACTIVE } },
];

export const lookupFavorite = {
  $lookup: {
    from: 'members',
    localField: 'favoriteEvent.organizerId',
    foreignField: '_id',
    as: 'favoriteEvent.memberData',
  },
};

export const lookupVisit = {
  $lookup: {
    from: 'members',
    localField: 'visitedEvent.organizerId',
    foreignField: '_id',
    as: 'visitedEvent.memberData',
  },
};

export const lookupEvent = {
  $lookup: {
    from: 'events',
    localField: 'eventId',
    foreignField: '_id',
    as: 'eventData',
  },
};

/** like lookupEvent, with the event's venue attached as eventData.venueData (one nested join, no extra queries) */
export const lookupEventWithVenue = {
  $lookup: {
    from: 'events',
    let: { eventId: '$eventId' },
    pipeline: [
      { $match: { $expr: { $eq: ['$_id', '$$eventId'] } } },
      lookupVenue,
      { $unwind: { path: '$venueData', preserveNullAndEmptyArrays: true } },
    ],
    as: 'eventData',
  },
};

export const lookupTicketType = {
  $lookup: {
    from: 'ticketTypes',
    localField: 'ticketTypeId',
    foreignField: '_id',
    as: 'ticketTypeData',
  },
};

export const lookupSeat = {
  $lookup: {
    from: 'eventSeats',
    localField: 'seatId',
    foreignField: '_id',
    as: 'seatData',
  },
};
