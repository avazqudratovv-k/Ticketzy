import { registerEnumType } from '@nestjs/graphql';

export enum LikeGroup {
	MEMBER = 'MEMBER',
	EVENT = 'EVENT',
}
registerEnumType(LikeGroup, {
	name: 'LikeGroup',
});
