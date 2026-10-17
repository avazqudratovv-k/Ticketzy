import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join } from 'path';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import { GraphQLInputObjectType, GraphQLNonNull, GraphQLObjectType, GraphQLSchema } from 'graphql';

/** every resolver class of the API, found by file name, so a new resolver is covered without editing this spec */
const loadResolvers = (): Function[] => {
	const root = join(__dirname, '..');
	const files = [join(root, 'app.resolver')];
	for (const folder of readdirSync(join(root, 'components'), { withFileTypes: true })) {
		if (!folder.isDirectory()) continue;
		for (const file of readdirSync(join(root, 'components', folder.name))) {
			if (file.endsWith('.resolver.ts')) files.push(join(root, 'components', folder.name, file.replace(/\.ts$/, '')));
		}
	}
	return files.flatMap((file) => Object.values(require(file)).filter((value): value is Function => typeof value === 'function'));
};

describe('GraphQL schema (built without a database)', () => {
	let schema: GraphQLSchema;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({ imports: [GraphQLSchemaBuilderModule] }).compile();
		schema = await moduleRef.get(GraphQLSchemaFactory).create(loadResolvers());
	});

	it('builds, and has the 99 operations (42 queries, 57 mutations): none was renamed or dropped (101 before the follow feature went, #122; two account deletion operations, #123)', () => {
		expect(Object.keys(schema.getQueryType()!.getFields())).toHaveLength(42);
		expect(Object.keys(schema.getMutationType()!.getFields())).toHaveLength(57);
		for (const name of ['getEvents', 'getMember', 'getAllMembersByAdmin', 'updateMemberByAdmin', 'payOrder', 'imageUploader']) {
			const fields = { ...schema.getQueryType()!.getFields(), ...schema.getMutationType()!.getFields() };
			expect(fields[name]).toBeDefined();
		}
	});

	it('has no follow operation, type or field left (#122)', () => {
		const operations = [...Object.keys(schema.getQueryType()!.getFields()), ...Object.keys(schema.getMutationType()!.getFields())];
		expect(operations.filter((name) => /follow|subscribe/i.test(name))).toEqual([]);
		const typeNames = Object.keys(schema.getTypeMap()).filter((name) => /follow/i.test(name));
		expect(typeNames).toEqual([]);
		const member = schema.getType('Member') as GraphQLObjectType;
		expect(Object.keys(member.getFields()).filter((name) => /follow/i.test(name))).toEqual([]);
	});

	it('shows the caller\'s liked flag on events and on the answer of likeTargetEvent (#122)', () => {
		const event = schema.getType('Event') as GraphQLObjectType;
		expect(String(event.getFields().meLiked.type)).toBe('[MeLiked!]');
		expect(String(event.getFields().eventLikes.type)).toBe('Int!');
		expect(String(schema.getMutationType()!.getFields().likeTargetEvent.type)).toBe('Event!');
		const liked = schema.getType('MeLiked') as GraphQLObjectType;
		expect(Object.keys(liked.getFields()).sort()).toEqual(['likeRefId', 'memberId', 'myFavorite']);
	});

	it('keeps the QR check-in operations exactly as they were and adds the ticket code ones beside them (#116)', () => {
		const args = (type: any, name: string) => Object.fromEntries(type.getFields()[name].args.map((arg: any) => [arg.name, String(arg.type)]));
		expect(args(schema.getMutationType(), 'checkInTicket')).toEqual({ qrToken: 'String!', eventId: 'String' });
		expect(args(schema.getQueryType(), 'checkInPreview')).toEqual({ qrToken: 'String!', eventId: 'String' });
		expect(String(schema.getMutationType()!.getFields().checkInTicket.type)).toBe('CheckInResult!');
		expect(args(schema.getMutationType(), 'checkInTicketByCode')).toEqual({ input: 'CheckInByCodeInput!' });
		expect(args(schema.getQueryType(), 'checkInPreviewByCode')).toEqual({ input: 'CheckInByCodeInput!' });
		const input = schema.getType('CheckInByCodeInput') as any;
		expect(Object.fromEntries(Object.entries(input.getFields()).map(([k, f]: any) => [k, String(f.type)]))).toEqual({ eventId: 'String!', ticketCode: 'String!' });
	});

	it('has the account deletion operations with their inputs and outputs (#123)', () => {
		const fields = (type: any, name: string) => type.getFields()[name];
		const args = (type: any, name: string) => Object.fromEntries(type.getFields()[name].args.map((arg: any) => [arg.name, String(arg.type)]));
		expect(args(schema.getMutationType(), 'deleteMyAccount')).toEqual({ input: 'DeleteAccountInput!' });
		expect(String(fields(schema.getMutationType(), 'deleteMyAccount').type)).toBe('AccountDeletionResult!');
		expect(args(schema.getQueryType(), 'getMyAccountDeletionCheck')).toEqual({});
		expect(String(fields(schema.getQueryType(), 'getMyAccountDeletionCheck').type)).toBe('AccountDeletionCheck!');
		const input = schema.getType('DeleteAccountInput') as any;
		expect(Object.fromEntries(Object.entries(input.getFields()).map(([k, f]: any) => [k, String(f.type)]))).toEqual({ confirmation: 'String!' });
		const check = schema.getType('AccountDeletionCheck') as GraphQLObjectType;
		expect(Object.fromEntries(Object.entries(check.getFields()).map(([k, f]) => [k, String(f.type)]))).toEqual({
			canDelete: 'Boolean!',
			blockers: '[DeletionBlocker!]!',
			unusedUpcomingTickets: 'Int!',
		});
	});

	it('exposes the private Member fields as nullable (they answer null to everyone but the owner and admins)', () => {
		const member = schema.getType('Member') as GraphQLObjectType;
		for (const name of ['memberPhone', 'memberFullName', 'memberAddress', 'memberWarnings', 'memberBlocks', 'deletedAt', 'emailReusableAt', 'previousAccountId', 'reusedByMemberId', 'memberEmail']) {
			const field = member.getFields()[name];
			expect(field).toBeDefined();
			expect(field.type).not.toBeInstanceOf(GraphQLNonNull);
		}
		expect(Object.keys(member.getFields())).not.toContain('memberPassword');
	});

	it('every page and limit input is Int! with a default (page 1, limit 20), so clients may leave them out', () => {
		const inquiries = Object.values(schema.getTypeMap()).filter(
			(type): type is GraphQLInputObjectType => type instanceof GraphQLInputObjectType && 'limit' in type.getFields(),
		);
		expect(inquiries.length).toBeGreaterThanOrEqual(18);
		for (const inquiry of inquiries) {
			const { page, limit } = inquiry.getFields();
			expect(String(limit.type)).toBe('Int!');
			expect(limit.defaultValue).toBe(20);
			expect(String(page.type)).toBe('Int!');
			expect(page.defaultValue).toBe(1);
		}
	});
});
