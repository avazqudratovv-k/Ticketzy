import { TypeMetadataStorage } from '@nestjs/graphql';
import { LazyMetadataStorage } from '@nestjs/graphql/dist/schema-builder/storages/lazy-metadata.storage';
import { MemberResolver } from './member.resolver';
import { Member } from '../../libs/dto/member/member';
import { MemberType } from '../../libs/enums/member.enum';

/** Which `Member` fields an anonymous visitor may read (DECISIONS #90). A new `@Field` must be added to one list. */
const PUBLIC_FIELDS = [
	'_id',
	'memberType',
	'memberStatus',
	'memberAuthType',
	'memberNick',
	'memberImage',
	'memberDesc',
	'memberEvents',
	'completedEvents',
	'memberFollowers',
	'memberFollowings',
	'memberLikes',
	'memberViews',
	'memberComments',
	'memberRank',
	'createdAt',
	'updatedAt',
	'meLiked',
	'meFollowed',
];
/** public only for ORGANIZER accounts (organization name and address), private for everyone else */
const ORGANIZER_PUBLIC_FIELDS = ['memberFullName', 'memberAddress'];
/** the member themselves and admins only */
const PRIVATE_FIELDS = ['memberEmail', 'memberPhone', 'memberWarnings', 'memberBlocks', 'deletedAt', 'rejectReason', 'commissionOverride'];
/** returned only by login and signup, which authenticate the caller by password */
const TOKEN_FIELDS = ['accessToken'];

const memberFieldNames = (): string[] => {
	// the schema builder normally compiles the collected decorator metadata; do the same here
	LazyMetadataStorage.load([Member]);
	TypeMetadataStorage.compile();
	const type = TypeMetadataStorage.getObjectTypesMetadata().find((item) => item.target === Member);
	return type!.properties!.map((property) => property.name);
};

const buyer = {
	_id: 'buyer-1',
	memberType: MemberType.USER,
	memberEmail: 'buyer@example.com',
	memberPhone: '010-1111-2222',
	memberFullName: 'Buyer Real Name',
	memberAddress: '1 Home Street',
	memberWarnings: 2,
	memberBlocks: 1,
	deletedAt: new Date('2026-01-01'),
	rejectReason: 'private reason',
	commissionOverride: { rate: 3, reason: 'x' },
} as unknown as Member;

const organizer = { ...buyer, _id: 'org-1', memberType: MemberType.ORGANIZER, memberFullName: 'Big Stage Ltd', memberAddress: '5 Hall Road' } as unknown as Member;

const asCaller = (authMember: any) => ({ req: { body: { authMember } } });
const guest = asCaller(null);
const stranger = asCaller({ _id: 'someone-else', memberType: MemberType.USER });
const admin = asCaller({ _id: 'admin-1', memberType: MemberType.ADMIN });
const self = (member: Member) => asCaller({ _id: member._id, memberType: member.memberType });

describe('Member field privacy', () => {
	const resolver = new MemberResolver({} as any);
	const read = (field: string, member: Member, context: any) => (resolver as any)[field](member, context);

	it('lists every Member field in exactly one group (a new field must be classified)', () => {
		const classified = [...PUBLIC_FIELDS, ...ORGANIZER_PUBLIC_FIELDS, ...PRIVATE_FIELDS, ...TOKEN_FIELDS];
		expect(new Set(classified).size).toBe(classified.length);
		expect([...memberFieldNames()].sort()).toEqual([...classified].sort());
	});

	it('has a resolver gate for every private field and for the organizer-only fields', () => {
		for (const field of [...PRIVATE_FIELDS, ...ORGANIZER_PUBLIC_FIELDS]) {
			expect(typeof (resolver as any)[field]).toBe('function');
		}
		for (const field of PUBLIC_FIELDS) expect((resolver as any)[field]).toBeUndefined();
	});

	it.each(PRIVATE_FIELDS)('%s is hidden from guests and other members', (field) => {
		expect(read(field, buyer, guest)).toBeNull();
		expect(read(field, buyer, stranger)).toBeNull();
		expect(read(field, organizer, guest)).toBeNull();
	});

	it.each(PRIVATE_FIELDS)('%s is shown to the member themselves and to admins', (field) => {
		expect(read(field, buyer, self(buyer))).not.toBeNull();
		expect(read(field, buyer, admin)).not.toBeNull();
	});

	it('hides the full name and address of a buyer from guests and strangers', () => {
		for (const field of ORGANIZER_PUBLIC_FIELDS) {
			expect(read(field, buyer, guest)).toBeNull();
			expect(read(field, buyer, stranger)).toBeNull();
			expect(read(field, buyer, self(buyer))).not.toBeNull();
			expect(read(field, buyer, admin)).not.toBeNull();
		}
	});

	it('shows the organization name and address of an organizer to everyone', () => {
		expect(read('memberFullName', organizer, guest)).toBe('Big Stage Ltd');
		expect(read('memberAddress', organizer, guest)).toBe('5 Hall Road');
	});

	it('still hides the organizer phone, email and warnings from guests', () => {
		expect(read('memberPhone', organizer, guest)).toBeNull();
		expect(read('memberEmail', organizer, guest)).toBeNull();
		expect(read('memberWarnings', organizer, guest)).toBeNull();
	});

	it('ignores a forged authMember that is not in the request body of a guard', () => {
		expect(read('memberPhone', buyer, { req: {} })).toBeNull();
		expect(read('memberPhone', buyer, undefined)).toBeNull();
	});

	it('returns zero for missing counters when the caller may see them', () => {
		expect(read('memberWarnings', { ...buyer, memberWarnings: undefined } as any, admin)).toBe(0);
	});
});
