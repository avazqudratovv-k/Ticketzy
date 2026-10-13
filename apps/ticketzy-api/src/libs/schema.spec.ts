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

	it('builds, and still has the 97 operations (41 queries, 56 mutations): none was renamed or dropped', () => {
		expect(Object.keys(schema.getQueryType()!.getFields())).toHaveLength(41);
		expect(Object.keys(schema.getMutationType()!.getFields())).toHaveLength(56);
		for (const name of ['getEvents', 'getMember', 'getAllMembersByAdmin', 'updateMemberByAdmin', 'payOrder', 'imageUploader']) {
			const fields = { ...schema.getQueryType()!.getFields(), ...schema.getMutationType()!.getFields() };
			expect(fields[name]).toBeDefined();
		}
	});

	it('exposes the private Member fields as nullable (they answer null to everyone but the owner and admins)', () => {
		const member = schema.getType('Member') as GraphQLObjectType;
		for (const name of ['memberPhone', 'memberFullName', 'memberAddress', 'memberWarnings', 'memberBlocks', 'deletedAt', 'memberEmail']) {
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
