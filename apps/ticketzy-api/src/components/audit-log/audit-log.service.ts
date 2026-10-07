import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogCreate, AuditLogs } from '../../libs/dto/audit-log/audit-log';
import { AuditLogsInquiry } from '../../libs/dto/audit-log/audit-log.input';
import { Direction, Message } from '../../libs/enums/common.enum';
import { T } from '../../libs/types/common';
import { lookupActor, shapeIntoMongoObjectId } from '../../libs/config';

@Injectable()
export class AuditLogService {
	private readonly logger = new Logger(AuditLogService.name);

	constructor(@InjectModel('AuditLog') private readonly auditLogModel: Model<AuditLog>) {}

	/**
	 * Called by other services after their own action succeeded.
	 * The action is already committed, so a failed write is logged loudly instead of failing the request.
	 */
	public async record(input: AuditLogCreate): Promise<void> {
		try {
			await this.auditLogModel.create(input);
		} catch (err) {
			this.logger.error(`AUDIT LOG NOT WRITTEN (${input.action} on ${input.targetId}): ${err.message}`);
		}
	}

	public async getAuditLogsByAdmin(input: AuditLogsInquiry): Promise<AuditLogs> {
		const { action, targetType, targetId, actorId } = input.search;
		const match: T = {};
		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (action) match.action = action;
		if (targetType) match.targetType = targetType;
		if (targetId) match.targetId = shapeIntoMongoObjectId(targetId);
		if (actorId) match.actorId = shapeIntoMongoObjectId(actorId);

		const result = await this.auditLogModel
			.aggregate([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupActor,
							{ $unwind: { path: '$actorData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		return result[0];
	}
}
