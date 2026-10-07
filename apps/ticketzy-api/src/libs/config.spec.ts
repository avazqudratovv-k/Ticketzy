import { Readable } from 'stream';
import { existsSync, readdirSync, rmSync } from 'fs';
import { detectImageExtension, escapeRegExp, saveVerifiedImage } from './config';
import { validateEnv } from './env.validation';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2, 3]);

describe('image magic bytes', () => {
	it('detects png and jpeg from the first bytes', () => {
		expect(detectImageExtension(png)).toBe('.png');
		expect(detectImageExtension(jpeg)).toBe('.jpg');
	});

	it('rejects other content, whatever the client says it is', () => {
		expect(detectImageExtension(Buffer.from('<?php echo 1; ?>'))).toBeNull();
		expect(detectImageExtension(Buffer.from('GIF89a......'))).toBeNull();
		expect(detectImageExtension(Buffer.alloc(0))).toBeNull();
	});

	describe('saveVerifiedImage', () => {
		const target = 'spec-upload-test';
		afterAll(() => rmSync(`uploads/${target}`, { recursive: true, force: true }));

		it('writes a real png under a server-chosen name and extension', async () => {
			const url = await saveVerifiedImage(Readable.from([png.subarray(0, 4), png.subarray(4)]), target);
			expect(url).toMatch(new RegExp(`^uploads/${target}/[0-9a-f-]{36}\\.png$`));
			expect(existsSync(url)).toBe(true);
		});

		it('writes nothing for a script renamed to .png', async () => {
			const before = readdirSync(`uploads/${target}`).length;
			await expect(saveVerifiedImage(Readable.from([Buffer.from('<?php system($_GET[1]); ?>')]), target)).rejects.toThrow(
				'Please provide jpg, jpeg or png images!',
			);
			expect(readdirSync(`uploads/${target}`).length).toBe(before);
		});
	});
});

describe('escapeRegExp', () => {
	it('neutralizes regex syntax in user text', () => {
		const text = '(a+)+$';
		expect(new RegExp(escapeRegExp(text), 'i').test('(a+)+$')).toBe(true);
		expect(new RegExp(escapeRegExp('.*'), 'i').test('anything')).toBe(false);
	});
});

describe('validateEnv', () => {
	it('crashes on a missing SECRET_TOKEN or Mongo URI', () => {
		expect(() => validateEnv(['SECRET_TOKEN'])({ MONGO_DEV: 'mongodb://x' })).toThrow('SECRET_TOKEN');
		expect(() => validateEnv(['SECRET_TOKEN'])({ SECRET_TOKEN: 's' })).toThrow('MONGO_DEV');
		expect(() => validateEnv(['SECRET_TOKEN'])({ NODE_ENV: 'production', SECRET_TOKEN: 's', MONGO_DEV: 'x' })).toThrow('MONGO_PROD');
		expect(() => validateEnv()({ MONGO_DEV: '   ' })).toThrow('MONGO_DEV');
	});

	it('passes when everything is set', () => {
		expect(() => validateEnv(['SECRET_TOKEN'])({ SECRET_TOKEN: 's', MONGO_DEV: 'mongodb://x' })).not.toThrow();
	});
});
