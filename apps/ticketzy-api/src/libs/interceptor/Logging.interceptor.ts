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

		if (requestType === 'graphql') {
			/** (1) Print Request */
			const gqlContext = GqlExecutionContext.create(context);
			// neither variables nor responses are logged: they carry passwords on login and signup and the profile data of members
			this.logger.log(`${gqlContext.getContext().req.body?.operationName ?? 'anonymous operation'}`, `REQUEST`);

			/** (2) No Errors, giving Response below: only the time it took */
			return next.handle().pipe(
				tap(() => {
					this.logger.log(`${Date.now() - recordTime}ms`, 'RESPONSE');
				}),
			);
		}
		// plain HTTP routes (/, /health, /ready) pass through untouched
		return next.handle();
	}
}
