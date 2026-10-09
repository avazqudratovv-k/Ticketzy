import 'reflect-metadata';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';

/** resolvers that are admin tools but do not carry "ByAdmin" in the operation name */
const adminOperationsWithoutSuffix = ['createNotice', 'updateNotice'];

const loadResolvers = (): Array<{ file: string; type: any }> => {
	const root = join(__dirname, '..');
	return readdirSync(root)
		.map((dir) => join(root, dir, `${dir}.resolver.ts`))
		.filter((file) => existsSync(file))
		.flatMap((file) => Object.values(require(file)).filter((value: any) => typeof value === 'function' && /Resolver$/.test(value.name)).map((type) => ({ file, type })));
};

describe('admin operations are ADMIN only', () => {
	const operations = loadResolvers().flatMap(({ type }) =>
		Object.getOwnPropertyNames(type.prototype)
			.filter((name) => name !== 'constructor' && typeof type.prototype[name] === 'function')
			.map((name) => ({ resolver: type.name, name, handler: type.prototype[name] })),
	);
	const isAdminOperation = (name: string) => /ByAdmin$/.test(name) || adminOperationsWithoutSuffix.includes(name);
	const guardNames = (handler: any) => (Reflect.getMetadata('__guards__', handler) ?? []).map((guard: any) => guard.name);

	it('finds the admin operations', () => {
		expect(operations.filter((op) => isAdminOperation(op.name)).length).toBeGreaterThanOrEqual(20);
	});

	it.each(operations.filter((op) => isAdminOperation(op.name)).map((op) => [`${op.resolver}.${op.name}`, op] as const))(
		'%s requires the ADMIN role and RolesGuard',
		(_label, op) => {
			expect(Reflect.getMetadata('roles', op.handler)).toEqual(['ADMIN']);
			expect(guardNames(op.handler)).toContain('RolesGuard');
		},
	);

	it('every handler that names ADMIN in its roles also runs RolesGuard, or the roles would not be enforced', () => {
		const unguarded = operations.filter((op) => (Reflect.getMetadata('roles', op.handler) ?? []).includes('ADMIN') && !guardNames(op.handler).includes('RolesGuard'));
		expect(unguarded.map((op) => `${op.resolver}.${op.name}`)).toEqual([]);
	});
});
