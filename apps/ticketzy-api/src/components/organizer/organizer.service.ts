import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Member, Members } from '../../libs/dto/member/member';
import { CommissionOverrideInput, OrganizerReasonInput, OrganizersByAdminInquiry } from '../../libs/dto/organizer/organizer.input';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';
import { Direction, Message } from '../../libs/enums/common.enum';
import { MemberStatus, MemberType, OrganizerAction, organizerTransitions } from '../../libs/enums/member.enum';
import { NotificationGroup, NotificationType } from '../../libs/enums/notification.enum';
import { T } from '../../libs/types/common';
import { escapeRegExp } from '../../libs/config';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationService } from '../notification/notification.service';

const transitionRecords: Record<OrganizerAction, { audit: AuditAction; notification: NotificationType; title: string }> = {
	verify: { audit: AuditAction.ORGANIZER_VERIFIED, notification: NotificationType.ORGANIZER_VERIFIED, title: 'Your organizer account was approved' },
	reject: { audit: AuditAction.ORGANIZER_REJECTED, notification: NotificationType.ORGANIZER_REJECTED, title: 'Your organizer account was rejected' },
	suspend: { audit: AuditAction.ORGANIZER_SUSPENDED, notification: NotificationType.ORGANIZER_SUSPENDED, title: 'Your organizer account was suspended' },
	reinstate: { audit: AuditAction.ORGANIZER_REINSTATED, notification: NotificationType.ORGANIZER_REINSTATED, title: 'Your organizer account was reinstated' },
};

@Injectable()
export class OrganizerService {
	private readonly logger = new Logger(OrganizerService.name);

	constructor(
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		private readonly auditLogService: AuditLogService,
		private readonly notificationService: NotificationService,
	) {}

	/** ADMIN */

	public async getOrganizersByAdmin(input: OrganizersByAdminInquiry): Promise<Members> {
		const { memberStatus, text } = input.search;
		const match: T = { memberType: MemberType.ORGANIZER };
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (memberStatus) match.memberStatus = memberStatus;
		if (text) {
			const regex = { $regex: new RegExp(escapeRegExp(text), 'i') };
			match.$or = [{ memberFullName: regex }, { memberNick: regex }, { memberEmail: regex }];
		}

		const result = await this.memberModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{ $project: { memberPassword: 0 } },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}

	public async verifyOrganizerByAdmin(adminId: ObjectId, memberId: ObjectId): Promise<Member> {
		return await this.changeStatus(adminId, memberId, 'verify');
	}

	public async rejectOrganizerByAdmin(adminId: ObjectId, input: OrganizerReasonInput): Promise<Member> {
		return await this.changeStatus(adminId, input.memberId, 'reject', this.requireReason(input.reason, Message.REJECT_REASON_REQUIRED));
	}

	public async suspendOrganizerByAdmin(adminId: ObjectId, input: OrganizerReasonInput): Promise<Member> {
		return await this.changeStatus(adminId, input.memberId, 'suspend', this.requireReason(input.reason, Message.SUSPEND_REASON_REQUIRED));
	}

	public async reinstateOrganizerByAdmin(adminId: ObjectId, memberId: ObjectId): Promise<Member> {
		return await this.changeStatus(adminId, memberId, 'reinstate');
	}

	public async setCommissionOverrideByAdmin(adminId: ObjectId, input: CommissionOverrideInput): Promise<Member> {
		const reason = this.requireReason(input.reason, Message.COMMISSION_REASON_REQUIRED);
		if (!(input.rate >= 0 && input.rate <= 100)) throw new BadRequestException(Message.INVALID_COMMISSION_RATE);
		if (input.endsAt && input.endsAt.getTime() <= Date.now()) throw new BadRequestException(Message.INVALID_COMMISSION_END_DATE);

		const result = await this.memberModel
			.findOneAndUpdate(
				{ _id: input.memberId, memberType: MemberType.ORGANIZER, memberStatus: { $ne: MemberStatus.DELETE } },
				{ commissionOverride: { rate: input.rate, endsAt: input.endsAt, reason } },
				{ new: true },
			)
			.exec();
		if (!result) throw new BadRequestException(Message.NO_ORGANIZER_FOUND);

		await this.auditLogService.record({
			actorId: adminId,
			action: AuditAction.COMMISSION_OVERRIDE_SET,
			targetType: AuditTargetType.MEMBER,
			targetId: result._id,
			meta: { rate: input.rate, endsAt: input.endsAt, reason },
		});
		await this.notify(adminId, result._id, NotificationType.COMMISSION_UPDATED, 'Your commission rate was changed', reason);
		return result;
	}

	/**
	 * One conditional update: it only matches when the organizer is in a status the action may start from,
	 * so two admins acting at once cannot both succeed.
	 */
	private async changeStatus(adminId: ObjectId, memberId: ObjectId, action: OrganizerAction, reason?: string): Promise<Member> {
		const { from, to } = organizerTransitions[action];
		const update: T = { $set: { memberStatus: to } };
		if (action === 'reject') update.$set.rejectReason = reason;
		else if (action !== 'suspend') update.$unset = { rejectReason: '' };

		const result = await this.memberModel
			.findOneAndUpdate({ _id: memberId, memberType: MemberType.ORGANIZER, memberStatus: { $in: from } }, update, { new: false })
			.exec();

		if (!result) {
			const current = await this.memberModel.findOne({ _id: memberId, memberType: MemberType.ORGANIZER }).lean().exec();
			if (!current) throw new BadRequestException(Message.NO_ORGANIZER_FOUND);
			throw new BadRequestException(Message.INVALID_STATUS_TRANSITION);
		}

		const record = transitionRecords[action];
		await this.auditLogService.record({
			actorId: adminId,
			action: record.audit,
			targetType: AuditTargetType.MEMBER,
			targetId: result._id,
			meta: { fromStatus: result.memberStatus, toStatus: to, ...(reason ? { reason } : {}) },
		});
		await this.notify(adminId, result._id, record.notification, record.title, reason);

		return await this.memberModel.findById(result._id).exec();
	}

	private requireReason(reason: string | undefined, message: string): string {
		const trimmed = reason?.trim();
		if (!trimmed) throw new BadRequestException(message);
		return trimmed;
	}

	/** never throws (createNotification swallows its own errors) and runs after the action is done */
	private async notify(adminId: ObjectId, organizerId: ObjectId, type: NotificationType, title: string, desc?: string): Promise<void> {
		await this.notificationService.createNotification({
			notificationType: type,
			notificationGroup: NotificationGroup.MEMBER,
			notificationTitle: title,
			notificationDesc: desc,
			authorId: adminId,
			receiverId: organizerId,
		});
	}
}

