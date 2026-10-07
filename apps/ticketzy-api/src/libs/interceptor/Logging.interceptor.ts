import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
	private readonly logger: Logger = new Logger();

	public intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
		const recordTime = Date.now();
		const requestType = context.getType<GqlContextType>();

		if (requestType === 'http') {
			// Develop if needed!
		} else if (requestType === 'graphql') {
			/** (1) Print Request */
			const gqlContext = GqlExecutionContext.create(context);
			// variables are not logged: they carry passwords on login and signup
			this.logger.log(`${gqlContext.getContext().req.body?.operationName ?? 'anonymous operation'}`, `REQUEST`);

			/** (2) Error handling via GraphQl */

			/** (3) No Errors, giving Response below */
			return next.handle().pipe(
				tap((context) => {
					const responseTime = Date.now() - recordTime;
					this.logger.log(`${this.stringfy(context)} - ${responseTime}ms \n\n`, 'RESPONSE');
				}),
			);
		}
	}

	private stringfy(context: ExecutionContext): string {
		return JSON.stringify(context).slice(0, 75);
	}
}
