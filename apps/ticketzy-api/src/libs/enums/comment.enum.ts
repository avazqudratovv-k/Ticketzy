import { registerEnumType } from '@nestjs/graphql';

export enum CommentStatus {
	ACTIVE = 'ACTIVE',
	DELETE = 'DELETE',
}
registerEnumType(CommentStatus, {
	name: 'CommentStatus',
});

/** comments are written on events only */
export enum CommentGroup {
	EVENT = 'EVENT',
}
registerEnumType(CommentGroup, {
	name: 'CommentGroup',
});
