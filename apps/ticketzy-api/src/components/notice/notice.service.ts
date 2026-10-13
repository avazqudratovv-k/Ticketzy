import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ObjectId } from 'mongoose';
import { Notice, Notices } from '../../libs/dto/notice/notice';
import { AllNoticesInquiry, NoticeInput, NoticesInquiry, NoticeUpdate } from '../../libs/dto/notice/notice.input';
import { Message } from '../../libs/enums/common.enum';
import { NoticeStatus } from '../../libs/enums/notice.enum';
import { T } from '../../libs/types/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction, AuditTargetType } from '../../libs/enums/audit-log.enum';

@Injectable()
export class NoticeService {
	private readonly logger = new Logger(NoticeService.name);

	constructor(
		@InjectModel('Notice') private readonly noticeModel: Model<Notice>,
		private readonly auditLogService: AuditLogService,
	) {}

	public async getNotices(input: NoticesInquiry): Promise<Notices> {
		const match: T = { noticeStatus: NoticeStatus.ACTIVE };
		if (input.search.noticeCategory) match.noticeCategory = input.search.noticeCategory;
		return await this.list(match, input.page, input.limit);
	}

	/** ADMIN */

	public async createNotice(memberId: ObjectId, input: NoticeInput): Promise<Notice> {
		input.memberId = memberId;
		let created: Notice;
		try {
			created = await this.noticeModel.create(input);
		} catch (err) {
			this.logger.error(`Error, Service.model: ${err.message}`);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
		await this.recordAudit(memberId, AuditAction.NOTICE_CREATED, created, { noticeCategory: created.noticeCategory });
		return created;
	}

	public async updateNotice(adminId: ObjectId, input: NoticeUpdate): Promise<Notice> {
		const result = await this.noticeModel
			.findOneAndUpdate({ _id: input._id, noticeStatus: { $ne: NoticeStatus.DELETE } }, input, { new: true })
			.exec();
		if (!result) throw new InternalServerErrorException(Message.UPDATE_FAILED);
		await this.recordAudit(adminId, AuditAction.NOTICE_UPDATED, result, {
			changedFields: Object.keys(input).filter((key) => key !== '_id' && (input as any)[key] !== undefined),
		});
		return result;
	}

	public async getAllNoticesByAdmin(input: AllNoticesInquiry): Promise<Notices> {
		const { noticeCategory, noticeStatus } = input.search;
		const match: T = {};
		if (noticeCategory) match.noticeCategory = noticeCategory;
		if (noticeStatus) match.noticeStatus = noticeStatus;
		return await this.list(match, input.page, input.limit);
	}

	public async removeNoticeByAdmin(adminId: ObjectId, noticeId: ObjectId): Promise<Notice> {
		const result = await this.noticeModel.findOneAndDelete({ _id: noticeId, noticeStatus: NoticeStatus.DELETE }).exec();
		if (!result) throw new InternalServerErrorException(Message.REMOVE_FAILED);
		await this.recordAudit(adminId, AuditAction.NOTICE_REMOVED, result, { noticeCategory: result.noticeCategory });
		return result;
	}

	private async recordAudit(adminId: ObjectId, action: AuditAction, notice: Notice, meta: Record<string, any>): Promise<void> {
		await this.auditLogService.record({ actorId: adminId, action, targetType: AuditTargetType.NOTICE, targetId: notice._id, meta });
	}

	private async list(match: T, page: number, limit: number): Promise<Notices> {
		const result = await this.noticeModel
			.aggregate([
				{ $match: match },
				{ $sort: { createdAt: -1 } },
				{
					$facet: {
						list: [{ $skip: (page - 1) * limit }, { $limit: limit }],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}
}
