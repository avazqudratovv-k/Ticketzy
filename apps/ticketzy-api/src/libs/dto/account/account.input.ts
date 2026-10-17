import { Field, InputType } from '@nestjs/graphql';
import { Equals } from 'class-validator';
import { DELETE_CONFIRMATION_WORD } from '../../account-deletion';

@InputType()
export class DeleteAccountInput {
	@Equals(DELETE_CONFIRMATION_WORD)
	@Field(() => String, { description: `must be exactly ${DELETE_CONFIRMATION_WORD}, so a script cannot delete an account by accident` })
	confirmation: string;
}
