import { ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ValidationFailedException, ValidationIssue } from './coded-exception';
import { Message } from './enums/common.enum';
import { mapValidationMessage } from './error-mapping';

/** nested inputs give a dotted path (`search.limit`); only property names and rule names are kept, never `value` (#113) */
export const flattenValidationErrors = (errors: ValidationError[], parent = ''): ValidationIssue[] =>
	errors.flatMap((error) => {
		const field = parent ? `${parent}.${error.property}` : error.property;
		const own = error.constraints ? [{ field, rules: Object.keys(error.constraints) }] : [];
		return [...own, ...flattenValidationErrors(error.children ?? [], field)];
	});

/** every constraint text (they name the property and a limit, no value), only to keep the page and limit sentences of #101 */
const constraintTexts = (errors: ValidationError[]): string[] =>
	errors.flatMap((error) => [...Object.values(error.constraints ?? {}), ...constraintTexts(error.children ?? [])]);

export const createValidationPipe = (): ValidationPipe =>
	new ValidationPipe({
		whitelist: true,
		transform: true,
		exceptionFactory: (errors) =>
			new ValidationFailedException(mapValidationMessage(constraintTexts(errors)) ?? Message.VALIDATION_FAILED, flattenValidationErrors(errors)),
	});
