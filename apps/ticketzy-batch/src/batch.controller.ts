import { Controller, Get, Logger } from '@nestjs/common';
import { BatchService } from './batch.service';
import { Cron, Interval, Timeout } from '@nestjs/schedule';
import { BATCH_EXPIRE_ORDERS, BATCH_ROLLBACK, BATCH_TOP_AGENTS, BATCH_TOP_EVENTS } from './lib/config';

@Controller()
export class BatchController {
  private logger: Logger = new Logger('BatchController');

  constructor(private readonly batchService: BatchService) {}

  @Timeout(1000)
  handleTimeout() {
    this.logger.debug('BATCH SERVER READY!');
  }

  // ranking jobs run hourly: rollback first, then the two top jobs fill the ranks back in
  @Cron('00 00 * * * *', { name: BATCH_ROLLBACK })
  public async batchRollback() {
    try {
      this.logger['context'] = BATCH_ROLLBACK;
      this.logger.debug('EXECUTED!');
      await this.batchService.batchRollback();
    } catch (err) {
      this.logger.error(err);
    }
  }

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

  @Cron('40 00 * * * *', { name: BATCH_TOP_AGENTS })
  public async batchTopAgents() {
    try {
      this.logger['context'] = BATCH_TOP_AGENTS;
      this.logger.debug('EXECUTED!');
      await this.batchService.batchTopAgents();
    } catch (err) {
      this.logger.error(err);
    }
  }

  // pending orders hold stock, so expiry runs every minute
  @Cron('10 * * * * *', { name: BATCH_EXPIRE_ORDERS })
  public async batchExpireOrders() {
    try {
      this.logger['context'] = BATCH_EXPIRE_ORDERS;
      await this.batchService.batchExpireOrders();
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
