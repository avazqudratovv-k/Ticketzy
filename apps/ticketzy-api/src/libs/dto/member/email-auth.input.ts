import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** requestEmailChange: the new address is checked and mailed; the old one stays until the link is opened (DECISIONS #135) */
@InputType()
export class EmailChangeInput {
	@IsNotEmpty()
	@IsEmail()
	@Transform(normalizeEmail)
	@Field(() => String)
	newEmail: string;

	/** the current password, so a stolen session cannot move the account to another address */
	@IsNotEmpty()
	@MaxLength(200)
	@Field(() => String)
	currentPassword: string;
}
