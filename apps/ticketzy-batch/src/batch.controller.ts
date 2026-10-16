import { Controller, Get, Logger } from '@nestjs/common';
import { BatchService } from './batch.service';
import { Cron, Interval, Timeout } from '@nestjs/schedule';
import { BATCH_END_EVENTS, BATCH_EXPIRE_ORDERS, BATCH_TOP_ORGANIZERS, BATCH_TOP_EVENTS, BATCH_DUE_PAYOUTS } from './lib/config';

@Controller()
export class BatchController {
  private logger: Logger = new Logger('BatchController');

  constructor(private readonly batchService: BatchService) {}

  @Timeout(1000)
  handleTimeout() {
    this.logger.debug('BATCH SERVER READY!');
  }

  // ranking jobs run hourly (events at hh:00:20, organizers at hh:00:40: six-field cron, second first); they compute new ranks and write them in place, no zeroing step
  @Cron('20 00 * * * *', { name: BATCH_TOP_EVENTS })
  public async batchTopEvents() {
    try {
      this.logger['context'] = BATCH_TOP_EVENTS;
      this.logger.debug('EXECUTED!');
      await this.batchService.batchTopEvents();
    } catch (err) {
      this.logger.error(err);
    }
  }

  @Cron('40 00 * * * *', { name: BATCH_TOP_ORGANIZERS })
  public async batchTopOrganizers() {
    try {
      this.logger['context'] = BATCH_TOP_ORGANIZERS;
      this.logger.debug('EXECUTED!');
      await this.batchService.batchTopOrganizers();
    } catch (err) {
      this.logger.error(err);
    }
  }

  // pending orders hold stock and seats, so expiry and the seat hold sweep run every minute
  @Cron('10 * * * * *', { name: BATCH_EXPIRE_ORDERS })
  public async batchExpireOrders() {
    try {
      this.logger['context'] = BATCH_EXPIRE_ORDERS;
      await this.batchService.batchExpireOrders();
    } catch (err) {
      this.logger.error(err);
    }
  }

  // approved events past their endAt become ENDED, hourly at minute 30
  @Cron('00 30 * * * *', { name: BATCH_END_EVENTS })
  public async batchEndEvents() {
    try {
      this.logger['context'] = BATCH_END_EVENTS;
      await this.batchService.batchEndEvents();
    } catch (err) {
      this.logger.error(err);
    }
  }

  // payouts that became due get their notice, hourly at minute 50 (DECISIONS #119)
  @Cron('00 50 * * * *', { name: BATCH_DUE_PAYOUTS })
  public async batchNotifyDuePayouts() {
    try {
      this.logger['context'] = BATCH_DUE_PAYOUTS;
      await this.batchService.batchNotifyDuePayouts();
    } catch (err) {
      this.logger.error(err);
    }
  }

  /*
  @Interval(1000)
  handleInterval() {
  this.logger.debug('INTERVAL TEST');
  }
  */

	@Get()
	getHello(): string {
  	return this.batchService.getHello();
  	}

}
