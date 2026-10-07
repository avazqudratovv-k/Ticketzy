import { Schema } from 'mongoose';
import { AuditAction, AuditTargetType } from '../enums/audit-log.enum';

const AuditLogSchema = new Schema(
	{
		actorId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},

		action: {
			type: String,
			enum: AuditAction,
			required: true,
		},

		targetType: {
			type: String,
			enum: AuditTargetType,
			required: true,
		},

		targetId: {
			type: Schema.Types.ObjectId,
			required: true,
		},

		/** action details, e.g. { reason, fromStatus, toStatus } or { rate, endsAt, reason } */
		meta: {
			type: Schema.Types.Mixed,
			default: {},
		},
	},
	{ timestamps: true, collection: 'audit_logs' },
);

AuditLogSchema.index({ createdAt: -1 });

export default AuditLogSchema;
