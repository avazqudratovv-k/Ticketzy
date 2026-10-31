import { Message } from './enums/common.enum';
import { FocalAreaType } from './enums/event.enum';

/** the canvas the sections of a layout are placed on (the frontend editor draws 1000 x 700) */
export const LAYOUT_CANVAS = { width: 1000, height: 700 };

export const PITCH_RATIO = { width: 105, length: 68 };

export interface FocalArea {
	type: FocalAreaType;
	/** top left corner on the canvas */
	x: number;
	y: number;
	width: number;
	height: number;
}

/** what a client may send: a PITCH needs no geometry, and any geometry it sends must equal the fixed one */
export type FocalAreaInput = Partial<Omit<FocalArea, 'type'>> & { type: FocalAreaType };

/** the "Stage" bar the frontend has always drawn at the top of the canvas; layouts without a stored focal area read as this */
export const DEFAULT_STAGE: FocalArea = { type: FocalAreaType.STAGE, x: 340, y: 4, width: 320, height: 22 };

/** 105 x 68 (the FIFA recommended pitch), centered: 420 x 272 = 105:68 exactly */
export const FIXED_PITCH: FocalArea = { type: FocalAreaType.PITCH, x: 290, y: 214, width: 420, height: 272 };

export const MIN_STAGE_SIZE = { width: 20, height: 10 };

const GEOMETRY_KEYS = ['x', 'y', 'width', 'height'] as const;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** the focal area of a stored layout; old layouts have none and read as the default stage */
export const readFocalArea = (layout: { focalArea?: Partial<FocalArea> | null } | null | undefined): FocalArea => {
	const stored = layout?.focalArea;
	if (!stored?.type) return { ...DEFAULT_STAGE };
	if (stored.type === FocalAreaType.PITCH) return { ...FIXED_PITCH };
	return { type: FocalAreaType.STAGE, x: stored.x ?? DEFAULT_STAGE.x, y: stored.y ?? DEFAULT_STAGE.y, width: stored.width ?? DEFAULT_STAGE.width, height: stored.height ?? DEFAULT_STAGE.height };
};

/**
 * The first reason a focal area from a client is refused, or null. A STAGE is free inside the canvas. A PITCH is fixed by the
 * server: geometry that is left out is fine, geometry that differs from FIXED_PITCH is refused (never silently replaced).
 */
export const getFocalAreaError = (input: FocalAreaInput | null | undefined): Message | null => {
	if (!input) return null;
	if (input.type === FocalAreaType.PITCH) {
		const different = GEOMETRY_KEYS.some((key) => input[key] !== undefined && input[key] !== FIXED_PITCH[key]);
		return different ? Message.FOCAL_AREA_PITCH_FIXED : null;
	}
	if (input.type !== FocalAreaType.STAGE) return Message.FOCAL_AREA_INVALID;
	if (!GEOMETRY_KEYS.every((key) => isFiniteNumber(input[key]))) return Message.FOCAL_AREA_INVALID;
	const { x, y, width, height } = input as FocalArea;
	if (width < MIN_STAGE_SIZE.width || height < MIN_STAGE_SIZE.height) return Message.FOCAL_AREA_INVALID;
	if (x < 0 || y < 0 || x + width > LAYOUT_CANVAS.width || y + height > LAYOUT_CANVAS.height) return Message.FOCAL_AREA_INVALID;
	return null;
};

/** what is stored: the fixed geometry for a PITCH whatever the client sent, the given rectangle for a STAGE */
export const buildFocalArea = (input: FocalAreaInput): FocalArea =>
	input.type === FocalAreaType.PITCH ? { ...FIXED_PITCH } : { type: FocalAreaType.STAGE, x: input.x, y: input.y, width: input.width, height: input.height };
