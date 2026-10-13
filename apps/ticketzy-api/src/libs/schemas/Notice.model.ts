import mongoose, { Schema } from 'mongoose';
import { NoticeCategory, NoticeStatus } from '../enums/notice.enum';

const NoticeSchema = new Schema(
	{
		noticeCategory: {
			type: String,
			enum: NoticeCategory,
			required: true,
		},

		noticeStatus: {
			type: String,
			enum: NoticeStatus,
			default: NoticeStatus.ACTIVE,
		},

		noticeTitle: {
			type: String,
			required: true,
		},

		noticeContent: {
			type: String,
			required: true,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'notices' },
);

// the public notice list: ACTIVE notices, newest first
NoticeSchema.index({ noticeStatus: 1, createdAt: -1 });

export default NoticeSchema;
