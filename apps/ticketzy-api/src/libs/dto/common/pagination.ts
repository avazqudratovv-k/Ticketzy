import { applyDecorators } from '@nestjs/common';
import { Field, Int } from '@nestjs/graphql';
import { IsInt, IsNotEmpty, Max, Min } from 'class-validator';

/** every list query takes `page` and `limit`; both have a default and an upper bound (DECISIONS #91) */
export const DEFAULT_PAGE = 1;
export const MAX_PAGE = 10000;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
/** only for the admin event list, which the admin dashboard fills with up to 200 rows in one request */
export const MAX_ADMIN_EVENTS_LIMIT = 200;

/** `page`: whole number from 1 to 10000, 1 when the client leaves it out */
export const PageField = () =>
	applyDecorators(IsNotEmpty(), IsInt(), Min(1), Max(MAX_PAGE), Field(() => Int, { defaultValue: DEFAULT_PAGE }));

/** `limit`: whole number from 1 to `max` (default 100), 20 when the client leaves it out */
export const LimitField = (max: number = MAX_PAGE_LIMIT) =>
	applyDecorators(IsNotEmpty(), IsInt(), Min(1), Max(max), Field(() => Int, { defaultValue: DEFAULT_PAGE_LIMIT }));
