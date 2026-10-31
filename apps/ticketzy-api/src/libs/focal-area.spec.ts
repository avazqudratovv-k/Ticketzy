import { Message } from './enums/common.enum';
import { FocalAreaType } from './enums/event.enum';
import { DEFAULT_STAGE, FIXED_PITCH, LAYOUT_CANVAS, PITCH_RATIO, buildFocalArea, getFocalAreaError, readFocalArea } from './focal-area';

const stage = (over: any = {}) => ({ type: FocalAreaType.STAGE, x: 300, y: 10, width: 400, height: 40, ...over });

describe('focal area (DECISIONS #127)', () => {
	it('the fixed pitch is exactly 105:68 and lies inside the canvas', () => {
		expect(FIXED_PITCH.width * PITCH_RATIO.length).toBe(FIXED_PITCH.height * PITCH_RATIO.width);
		expect(FIXED_PITCH.x).toBeGreaterThanOrEqual(0);
		expect(FIXED_PITCH.x + FIXED_PITCH.width).toBeLessThanOrEqual(LAYOUT_CANVAS.width);
		expect(FIXED_PITCH.y + FIXED_PITCH.height).toBeLessThanOrEqual(LAYOUT_CANVAS.height);
	});

	describe('PITCH', () => {
		it('needs no geometry from the client', () => {
			expect(getFocalAreaError({ type: FocalAreaType.PITCH })).toBeNull();
		});

		it('accepts exactly the fixed geometry', () => {
			expect(getFocalAreaError({ ...FIXED_PITCH })).toBeNull();
		});

		it.each([
			['x', { x: FIXED_PITCH.x + 1 }],
			['y', { y: FIXED_PITCH.y - 1 }],
			['width', { width: FIXED_PITCH.width + 10 }],
			['height', { height: FIXED_PITCH.height - 10 }],
			['a stretched ratio', { width: 600, height: 272 }],
		])('refuses a changed %s instead of replacing it silently', (_name, over) => {
			expect(getFocalAreaError({ type: FocalAreaType.PITCH, ...over })).toBe(Message.FOCAL_AREA_PITCH_FIXED);
		});

		it('is stored with the fixed geometry whatever the client sent', () => {
			expect(buildFocalArea({ type: FocalAreaType.PITCH })).toEqual(FIXED_PITCH);
			expect(buildFocalArea({ ...FIXED_PITCH })).toEqual(FIXED_PITCH);
		});

		it('reads as the fixed pitch even if a stored document was edited by hand', () => {
			expect(readFocalArea({ focalArea: { type: FocalAreaType.PITCH, x: 1, y: 2, width: 3, height: 4 } })).toEqual(FIXED_PITCH);
		});
	});

	describe('STAGE', () => {
		it('can be placed and resized inside the canvas', () => {
			expect(getFocalAreaError(stage())).toBeNull();
			expect(getFocalAreaError(stage({ x: 0, y: 0, width: LAYOUT_CANVAS.width, height: 100 }))).toBeNull();
			expect(buildFocalArea(stage())).toEqual(stage());
		});

		it.each([
			['no position', { x: undefined }],
			['not a number', { width: NaN }],
			['too small', { width: 5 }],
			['outside to the left', { x: -1 }],
			['outside to the right', { x: 800, width: 400 }],
			['outside at the bottom', { y: 690, height: 40 }],
		])('is refused when it has %s', (_name, over) => {
			expect(getFocalAreaError(stage(over))).toBe(Message.FOCAL_AREA_INVALID);
		});
	});

	it('refuses an unknown type', () => {
		expect(getFocalAreaError({ type: 'ARENA' as any })).toBe(Message.FOCAL_AREA_INVALID);
	});

	it('a layout saved before focal areas reads as the default stage, with the size of the stage bar the frontend always drew', () => {
		expect(readFocalArea({})).toEqual(DEFAULT_STAGE);
		expect(readFocalArea(null)).toEqual(DEFAULT_STAGE);
		expect(DEFAULT_STAGE).toMatchObject({ type: FocalAreaType.STAGE, width: 320, height: 22 });
	});
});
