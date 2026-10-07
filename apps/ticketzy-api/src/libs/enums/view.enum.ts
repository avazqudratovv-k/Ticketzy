import { registerEnumType } from '@nestjs/graphql';

export enum ViewGroup {
	MEMBER = 'MEMBER',
	EVENT = 'EVENT',
}
registerEnumType(ViewGroup, {
	name: 'ViewGroup',
});
