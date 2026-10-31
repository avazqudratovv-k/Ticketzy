/**
 * Static content of the demo seed: names, venues, event texts (DECISIONS #108, #112). Everything is fictional and set in South Korea:
 * artists, bands and comedians are invented, football fixtures are invented matches between real K League 1 club names (no crests,
 * logos or player names) and say so in their description, venues have real Korean names but fictional seating layouts, phone
 * numbers are the 010-0000 test range. Texts exist in en, ko, ru and uz, the locales the app stores translations for.
 */
import { EventCategory, SectionKind, SectionSpacing, VenueType } from './enums/event.enum';
import { VenueLayoutSection } from './venue-layout';
import { FocalArea } from './focal-area';
import { VenueTemplateKey, instantiateTemplate } from './venue-templates';

export type DemoLocale = 'en' | 'ko' | 'ru' | 'uz';
export const DEMO_LOCALES: DemoLocale[] = ['en', 'ko', 'ru', 'uz'];
export type Localized = Record<DemoLocale, string>;

/**
 * IMAGES: real photos committed in `demo-images/` (credits in `demo-images/CREDITS.md`), served by the API at `/demo-images/`.
 * The stored value is the relative path `demo-images/<name>.jpg`, the same form as `uploads/...`: the frontend puts its API address
 * in front of a path that does not start with http. The pool of a category is only used for events of that category.
 */
export const DEMO_IMAGE_DIR = 'demo-images';
export const DEMO_IMAGE_COUNTS = { concert: 8, football: 6, comedy: 5, other: 5, venue: 7 } as const;
export const DEMO_IMAGE_PREFIX: Partial<Record<EventCategory, keyof typeof DEMO_IMAGE_COUNTS>> = {
	[EventCategory.CONCERT]: 'concert',
	[EventCategory.FOOTBALL]: 'football',
	[EventCategory.COMEDY]: 'comedy',
	[EventCategory.OTHER]: 'other',
};
export const demoImagePath = (pool: keyof typeof DEMO_IMAGE_COUNTS, number: number): string => {
	const index = ((number - 1) % DEMO_IMAGE_COUNTS[pool]) + 1;
	return `${DEMO_IMAGE_DIR}/${pool}-${String(index).padStart(2, '0')}.jpg`;
};
/** the two pictures of the `ordinal`-th event of a category (0 based): consecutive images of its pool, so neighbours differ */
export const demoEventImages = (category: EventCategory, ordinal: number): string[] => {
	const pool = DEMO_IMAGE_PREFIX[category];
	if (!pool) throw new Error(`No demo images for category ${category}`);
	return [demoImagePath(pool, ordinal * 2 + 1), demoImagePath(pool, ordinal * 2 + 2)];
};

/** ORGANIZERS */

export type OrganizerKey = 'hanbit' | 'mirae' | 'harbor' | 'cellar' | 'camellia' | 'nomad' | 'neon' | 'jeju' | 'pending' | 'rejected';

export interface DemoOrganizer {
	key: OrganizerKey;
	email: string;
	nick: string;
	/** a Korean company name */
	fullName: string;
	/** district and city only, no street number */
	address: string;
	/** test range 010-0000-xxxx */
	phone: string;
	desc: string;
	/** the admin action that brings the account to its final status; a PENDING organizer stays as signed up */
	outcome?: 'verify' | 'reject';
	rejectReason?: string;
}

export const DEMO_ORGANIZERS: DemoOrganizer[] = [
	{
		key: 'hanbit',
		email: 'organizer@ticketzy.demo',
		nick: 'hanbit_live',
		fullName: '한빛라이브엔터테인먼트(주)',
		address: 'Seogyo-dong, Mapo-gu, Seoul',
		phone: '010-0000-0001',
		desc: 'Concerts, football matches and comedy nights across Seoul, Incheon and Gwangju. Organizing live events since 2019.',
		outcome: 'verify',
	},
	{
		key: 'mirae',
		email: 'mirae.mudae@ticketzy.demo',
		nick: 'mirae_stage',
		fullName: '미래무대(주)',
		address: 'Wansan-gu, Jeonju, Jeonbuk',
		phone: '010-0000-0002',
		desc: 'A small company that brings jazz, folk and pop artists to regional theaters.',
		outcome: 'verify',
	},
	{
		key: 'harbor',
		email: 'hanggu.sports@ticketzy.demo',
		nick: 'harbor_sports',
		fullName: '항구스포츠프로모션(주)',
		address: 'Jung-gu, Incheon',
		phone: '010-0000-0003',
		desc: 'Match day tickets for league and cup football in Seoul, Incheon and Gwangju.',
		outcome: 'verify',
	},
	{
		key: 'cellar',
		email: 'useumchanggo.production@ticketzy.demo',
		nick: 'laugh_cellar',
		fullName: '웃음창고프로덕션(주)',
		address: 'Busanjin-gu, Busan',
		phone: '010-0000-0004',
		desc: 'Stand-up and improv every week. Bilingual shows for visitors and locals.',
		outcome: 'verify',
	},
	{
		key: 'camellia',
		email: 'dongbaek.art@ticketzy.demo',
		nick: 'camellia_arts',
		fullName: '동백아트컬렉티브(주)',
		address: 'Yuseong-gu, Daejeon',
		phone: '010-0000-0005',
		desc: 'Talks, markets and expos for creators: webtoon, vinyl, indie games and more.',
		outcome: 'verify',
	},
	{
		key: 'nomad',
		email: 'silkroad.munhwa@ticketzy.demo',
		nick: 'silkroad_culture',
		fullName: '실크로드문화그룹(주)',
		address: 'Yeonsu-gu, Incheon',
		phone: '010-0000-0006',
		desc: 'Cultural evenings and festivals for the Central Asian and Russian-speaking community in Korea.',
		outcome: 'verify',
	},
	{
		key: 'neon',
		email: 'neonaeli.event@ticketzy.demo',
		nick: 'neon_alley',
		fullName: '네온앨리이벤트(주)',
		address: 'Mapo-gu, Seoul',
		phone: '010-0000-0007',
		desc: 'Electronic and pop nights in small live houses.',
		outcome: 'verify',
	},
	{
		key: 'jeju',
		email: 'gyulbitseom.festival@ticketzy.demo',
		nick: 'tangerine_fest',
		fullName: '귤빛섬페스티벌(주)',
		address: 'Jeju-si, Jeju',
		phone: '010-0000-0008',
		desc: 'Concerts and festivals on Jeju Island and on tour in Gyeonggi, all year round.',
		outcome: 'verify',
	},
	{
		key: 'pending',
		email: 'pending@ticketzy.demo',
		nick: 'new_stage',
		fullName: '새무대프로덕션(주)',
		address: 'Nam-gu, Ulsan',
		phone: '010-0000-0009',
		desc: 'A new organizer waiting for admin approval.',
	},
	{
		key: 'rejected',
		email: 'rejected@ticketzy.demo',
		nick: 'ghost_tickets',
		fullName: '유령티켓(주)',
		address: 'Dongnae-gu, Busan',
		phone: '010-0000-0010',
		desc: 'An organizer whose application was declined.',
		outcome: 'reject',
		rejectReason: 'We could not verify your business registration. Please contact support with the registration certificate.',
	},
];

/** BUYERS: the first one is the demo buyer; all names are Korean. The e-mail is the romanized name (family.given, the nick is given_family); only `buyer@` keeps its fixed name */

export interface DemoBuyer {
	email: string;
	nick: string;
	fullName: string;
	/** test range 010-0000-1xxx */
	phone: string;
	/** a Seoul district, no street number */
	address: string;
}

const SEOUL_DISTRICTS = [
	'Gangnam-gu', 'Mapo-gu', 'Songpa-gu', 'Seodaemun-gu', 'Yongsan-gu', 'Seongdong-gu', 'Gwangjin-gu', 'Jongno-gu',
	'Gangseo-gu', 'Nowon-gu', 'Eunpyeong-gu', 'Dongjak-gu', 'Gwanak-gu', 'Yeongdeungpo-gu', 'Seocho-gu',
];

/** [full name, e-mail slug, nick] */
const BUYER_ROWS: [string, string, string][] = [
	['김민준', 'buyer', 'buyer'],
	['김서연', 'kim.seoyeon', 'seoyeon_kim'],
	['이도윤', 'lee.doyun', 'doyun_lee'],
	['박지우', 'park.jiwoo', 'jiwoo_park'],
	['최하은', 'choi.haeun', 'haeun_choi'],
	['정시우', 'jung.siwoo', 'siwoo_jung'],
	['강예린', 'kang.yerin', 'yerin_kang'],
	['조현우', 'jo.hyunwoo', 'hyunwoo_jo'],
	['윤서아', 'yoon.seoa', 'seoa_yoon'],
	['장민재', 'jang.minjae', 'minjae_jang'],
	['임지민', 'lim.jimin', 'jimin_lim'],
	['한유진', 'han.yujin', 'yujin_han'],
	['오태양', 'oh.taeyang', 'taeyang_oh'],
	['서나연', 'seo.nayeon', 'nayeon_seo'],
	['신동현', 'shin.donghyun', 'donghyun_shin'],
	['김하준', 'kim.haju', 'haju_kim'],
	['이서윤', 'lee.seoyun', 'seoyun_lee'],
	['박준서', 'park.junseo', 'junseo_park'],
	['최지안', 'choi.jian', 'jian_choi'],
	['정우진', 'jung.woojin', 'woojin_jung'],
	['강수아', 'kang.sua', 'sua_kang'],
	['조민서', 'jo.minseo', 'minseo_jo'],
	['윤도현', 'yoon.dohyeon', 'dohyeon_yoon'],
	['장예준', 'jang.yejun', 'yejun_jang'],
	['임채원', 'lim.chaewon', 'chaewon_lim'],
	['한지호', 'han.jiho', 'jiho_han'],
	['오소율', 'oh.soyul', 'soyul_oh'],
	['서건우', 'seo.geonwoo', 'geonwoo_seo'],
	['신유나', 'shin.yuna', 'yuna_shin'],
	['권태민', 'kwon.taemin', 'taemin_kwon'],
	['황가은', 'hwang.gaeun', 'gaeun_hwang'],
	['안시현', 'ahn.sihyeon', 'sihyeon_ahn'],
	['송재윤', 'song.jaeyun', 'jaeyun_song'],
	['류하린', 'ryu.harin', 'harin_ryu'],
	['전성민', 'jeon.seongmin', 'seongmin_jeon'],
	['홍다은', 'hong.daeun', 'daeun_hong'],
	['고민우', 'go.minwoo', 'minwoo_go'],
	['문지유', 'moon.jiyu', 'jiyu_moon'],
	['양현서', 'yang.hyunseo', 'hyunseo_yang'],
	['손예나', 'son.yena', 'yena_son'],
	['배준혁', 'bae.junhyeok', 'junhyeok_bae'],
	['백서현', 'baek.seohyeon', 'seohyeon_baek'],
	['허지원', 'heo.jiwon', 'jiwon_heo'],
	['노승현', 'noh.seunghyeon', 'seunghyeon_noh'],
	['심하늘', 'sim.haneul', 'haneul_sim'],
	['구본석', 'gu.bonseok', 'bonseok_gu'],
	['마서진', 'ma.seojin', 'seojin_ma'],
	['진아름', 'jin.areum', 'areum_jin'],
	['방수현', 'bang.suhyeon', 'suhyeon_bang'],
	['도하윤', 'do.hayun', 'hayun_do'],
];

export const DEMO_BUYERS: DemoBuyer[] = BUYER_ROWS.map(([fullName, slug, nick], index) => ({
	email: `${slug}@ticketzy.demo`,
	nick,
	fullName,
	phone: `010-0000-${String(1001 + index).padStart(4, '0')}`,
	address: `${SEOUL_DISTRICTS[index % SEOUL_DISTRICTS.length]}, Seoul`,
}));

/**
 * VENUES: twelve venues in ten Korean cities with real names (district and city only, coordinates are approximate). Eight are built from
 * the four venue templates of libs/venue-templates.ts (the same data the layout editor gets from `getVenueTemplates`), four have a layout of
 * their own. The layouts sit on a 1000 x 700 canvas. The three stadiums are the home grounds of the football
 * clubs in `DEMO_CLUBS`; `images` are two of the committed `venue-NN.jpg` photos.
 */

export type VenueKey = 'hall' | 'stadium' | 'club' | 'playhouse' | 'arena' | 'expo' | 'openair' | 'fortress' | 'livehouse' | 'goyang' | 'jejuarena' | 'suwon';

export interface DemoVenue {
	key: VenueKey;
	name: string;
	type: VenueType;
	city: string;
	address: string;
	coordinates: [number, number];
	owner: OrganizerKey;
	/** the template the layout was built from (libs/venue-templates.ts), if any; the other venues have a layout of their own */
	template?: VenueTemplateKey;
	sections: VenueLayoutSection[];
	/** the stage or pitch: the one of the template, or the default stage for a layout of its own */
	focalArea?: FocalArea;
	images: string[];
}

const section = (
	key: string,
	name: string,
	kind: SectionKind,
	rows: number,
	seatsPerRow: number,
	x: number,
	y: number,
	rotation: number,
	spacing: SectionSpacing,
	extra: { tierKey?: string; capacity?: number } = {},
): VenueLayoutSection => ({ key, name, kind, rows, seatsPerRow, x, y, rotation, spacing, ...extra });

const { SEATED, STANDING } = SectionKind;
const { COMPACT, NORMAL, WIDE } = SectionSpacing;

/** a venue whose layout is a copy of a template: sections, levels and the stage or pitch come from the template */
const fromTemplate = (key: VenueTemplateKey): Pick<DemoVenue, 'template' | 'sections' | 'focalArea'> => {
	const layout = instantiateTemplate(key);
	return { template: key, sections: layout.sections, focalArea: layout.focalArea };
};

export const DEMO_VENUES: DemoVenue[] = [
	{
		key: 'hall',
		name: 'Seoul Arts Center Concert Hall',
		type: VenueType.HALL,
		city: 'Seoul',
		address: 'Seocho-gu, Seoul',
		coordinates: [127.0117, 37.4788],
		owner: 'hanbit',
		images: [demoImagePath('venue', 1), demoImagePath('venue', 2)],
		...fromTemplate('CONCERT_HALL'),
	},
	{
		key: 'stadium',
		name: 'Seoul World Cup Stadium',
		type: VenueType.STADIUM,
		city: 'Seoul',
		address: 'Mapo-gu, Seoul',
		coordinates: [126.8972, 37.5683],
		owner: 'harbor',
		images: [demoImagePath('venue', 5), demoImagePath('venue', 6)],
		...fromTemplate('FOOTBALL_STADIUM'),
	},
	{
		key: 'club',
		name: 'Seomyeon Laugh Hall',
		type: VenueType.CLUB,
		city: 'Busan',
		address: 'Busanjin-gu, Busan',
		coordinates: [129.059, 35.1579],
		owner: 'cellar',
		images: [demoImagePath('venue', 3), demoImagePath('venue', 7)],
		...fromTemplate('COMEDY_CLUB'),
	},
	{
		key: 'playhouse',
		name: 'Jeonju Hanok Village Theater',
		type: VenueType.THEATER,
		city: 'Jeonju',
		address: 'Wansan-gu, Jeonju',
		coordinates: [127.153, 35.815],
		owner: 'mirae',
		images: [demoImagePath('venue', 3), demoImagePath('venue', 4)],
		sections: [
			section('STALLS', 'Stalls', SEATED, 6, 10, 500, 260, 0, NORMAL, { tierKey: 'PREMIUM' }),
			section('CIRCLE', 'Upper Circle', SEATED, 6, 12, 500, 500, 0, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'arena',
		name: 'EXCO Daegu',
		type: VenueType.HALL,
		city: 'Daegu',
		address: 'Buk-gu, Daegu',
		coordinates: [128.6126, 35.9072],
		owner: 'camellia',
		images: [demoImagePath('venue', 6), demoImagePath('venue', 5)],
		...fromTemplate('ARENA'),
	},
	{
		key: 'expo',
		name: 'Daejeon Convention Center',
		type: VenueType.HALL,
		city: 'Daejeon',
		address: 'Yuseong-gu, Daejeon',
		coordinates: [127.3977, 36.3752],
		owner: 'camellia',
		images: [demoImagePath('venue', 4), demoImagePath('venue', 2)],
		sections: [
			section('FLOOR', 'Open Floor', STANDING, 1, 1, 500, 360, 0, COMPACT, { capacity: 400 }),
			section('LEFT', 'Left Seating', SEATED, 8, 12, 150, 360, 270, NORMAL, { tierKey: 'PREMIUM' }),
			section('RIGHT', 'Right Seating', SEATED, 8, 12, 850, 360, 90, NORMAL, { tierKey: 'PREMIUM' }),
			section('GALLERY', 'Gallery', SEATED, 5, 20, 500, 600, 0, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'openair',
		name: 'Gwangju World Cup Stadium',
		type: VenueType.STADIUM,
		city: 'Gwangju',
		address: 'Seo-gu, Gwangju',
		coordinates: [126.8885, 35.134],
		owner: 'harbor',
		images: [demoImagePath('venue', 6), demoImagePath('venue', 5)],
		...fromTemplate('FOOTBALL_STADIUM'),
	},
	{
		key: 'fortress',
		name: 'Incheon Football Stadium',
		type: VenueType.STADIUM,
		city: 'Incheon',
		address: 'Michuhol-gu, Incheon',
		coordinates: [126.6946, 37.4627],
		owner: 'harbor',
		images: [demoImagePath('venue', 5), demoImagePath('venue', 6)],
		...fromTemplate('FOOTBALL_STADIUM'),
	},
	{
		key: 'livehouse',
		name: 'Hongdae Live Stage',
		type: VenueType.CLUB,
		city: 'Seoul',
		address: 'Mapo-gu, Seoul',
		coordinates: [126.924, 37.5563],
		owner: 'neon',
		images: [demoImagePath('venue', 7), demoImagePath('venue', 6)],
		sections: [
			section('STANDING', 'Standing Floor', STANDING, 1, 1, 500, 380, 0, COMPACT, { capacity: 350 }),
			section('LOUNGE', 'Balcony Lounge', SEATED, 3, 14, 500, 120, 0, WIDE, { tierKey: 'VIP' }),
		],
	},
	{
		key: 'goyang',
		name: 'Goyang Aram Nuri Arts Center',
		type: VenueType.HALL,
		city: 'Goyang',
		address: 'Ilsandong-gu, Goyang',
		coordinates: [126.774, 37.6575],
		owner: 'nomad',
		images: [demoImagePath('venue', 1), demoImagePath('venue', 4)],
		sections: [
			section('ORCH', 'Orchestra', SEATED, 8, 14, 500, 300, 0, NORMAL, { tierKey: 'PREMIUM' }),
			section('BALCONY', 'Balcony', SEATED, 5, 14, 500, 560, 0, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'jejuarena',
		name: 'Jeju Halla Gymnasium',
		type: VenueType.HALL,
		city: 'Jeju',
		address: 'Jeju-si, Jeju',
		coordinates: [126.5312, 33.4996],
		owner: 'jeju',
		images: [demoImagePath('venue', 2), demoImagePath('venue', 7)],
		...fromTemplate('ARENA'),
	},
	{
		key: 'suwon',
		name: 'Gyeonggi Arts Center Small Theater',
		type: VenueType.THEATER,
		city: 'Suwon',
		address: 'Paldal-gu, Suwon',
		coordinates: [127.0286, 37.2636],
		owner: 'mirae',
		images: [demoImagePath('venue', 4), demoImagePath('venue', 3)],
		...fromTemplate('COMEDY_CLUB'),
	},
];

/** how a ticket type of a general admission event at a venue is sized: [general, premium] */
export const GA_QUANTITIES: Record<VenueKey, [number, number]> = {
	hall: [220, 40],
	stadium: [1000, 100],
	club: [60, 12],
	playhouse: [80, 20],
	arena: [800, 120],
	expo: [250, 50],
	openair: [1800, 200],
	fortress: [600, 60],
	livehouse: [250, 40],
	goyang: [120, 30],
	jejuarena: [700, 100],
	suwon: [60, 12],
};

/** the tier names a RESERVED event shows; the tier keys come from the venue layouts above */
export const TIER_NAMES: Record<string, string> = {
	VIP: 'VIP',
	PREMIUM: 'Premium',
	GOLD: 'Gold',
	STANDARD: 'Standard',
	FRONT: 'Front Row',
};
/** price of a tier relative to the Standard price of the category */
export const TIER_FACTORS: Record<string, number> = { VIP: 3, PREMIUM: 1.6, GOLD: 1.9, STANDARD: 1, FRONT: 1.4 };
/** Standard price in won; every price is a multiple of 1000, so the commission of 10, 7 and 5 percent is a whole number of won */
export const CATEGORY_PRICES: Record<string, number> = {
	[EventCategory.CONCERT]: 55000,
	[EventCategory.FOOTBALL]: 15000,
	[EventCategory.COMEDY]: 25000,
	[EventCategory.OTHER]: 20000,
};
/** every ticket price of a category lies in this range (the plan clamps the tier and zone factors to it) */
export const CATEGORY_PRICE_RANGE: Record<string, [number, number]> = {
	[EventCategory.CONCERT]: [55000, 165000],
	[EventCategory.FOOTBALL]: [15000, 60000],
	[EventCategory.COMEDY]: [25000, 55000],
	[EventCategory.OTHER]: [20000, 80000],
};

/** EVENT BASES: texts in four languages; an edition number (language neutral) tells repeated shows apart */

export interface DemoBase {
	id: string;
	category: EventCategory;
	title: Localized;
	desc: Localized;
	/** football only: the invented match; the home club decides the venue */
	fixture?: DemoFixture;
}

const base = (id: string, category: EventCategory, title: Localized, desc: Localized, fixture?: DemoFixture): DemoBase => ({ id, category, title, desc, fixture });
const t = (en: string, ko: string, ru: string, uz: string): Localized => ({ en, ko, ru, uz });
const { CONCERT, FOOTBALL, COMEDY, OTHER } = EventCategory;

/** FOOTBALL: real K League 1 clubs of the 2026 season (checked against the league's club list) with the home ground of each; no crests, logos or players */

export type ClubKey = 'seoul' | 'incheon' | 'gwangju' | 'jeonbuk' | 'ulsan' | 'pohang' | 'jeju' | 'daejeon';

export interface DemoClub {
	key: ClubKey;
	name: Localized;
	/** the demo venue that is this club's home ground; only clubs with a venue can play at home */
	homeVenue?: VenueKey;
	stadium: Localized;
}

export const DEMO_CLUBS: DemoClub[] = [
	{
		key: 'seoul',
		name: t('FC Seoul', 'FC 서울', 'ФК Сеул', 'FC Seul'),
		homeVenue: 'stadium',
		stadium: t('Seoul World Cup Stadium', '서울월드컵경기장', 'стадион «Сеул Ворлд Кап»', 'Seoul World Cup stadioni'),
	},
	{
		key: 'incheon',
		name: t('Incheon United', '인천 유나이티드', 'Инчхон Юнайтед', 'Inchxon Yunayted'),
		homeVenue: 'fortress',
		stadium: t('Incheon Football Stadium', '인천축구전용경기장', 'стадион «Инчхон Футбол»', 'Incheon Football stadioni'),
	},
	{
		key: 'gwangju',
		name: t('Gwangju FC', '광주FC', 'Кванджу', 'Kvanju FC'),
		homeVenue: 'openair',
		stadium: t('Gwangju World Cup Stadium', '광주월드컵경기장', 'стадион «Кванджу Ворлд Кап»', 'Gwangju World Cup stadioni'),
	},
	{ key: 'jeonbuk', name: t('Jeonbuk Hyundai Motors', '전북 현대 모터스', 'Чонбук Хёндэ Моторс', 'Chonbuk Xyundey Motors'), stadium: t('', '', '', '') },
	{ key: 'ulsan', name: t('Ulsan HD', '울산 HD', 'Ульсан эйч-ди', 'Ulsan HD'), stadium: t('', '', '', '') },
	{ key: 'pohang', name: t('Pohang Steelers', '포항 스틸러스', 'Пхохан Стилерс', 'Pohang Stilers'), stadium: t('', '', '', '') },
	{ key: 'jeju', name: t('Jeju SK', '제주 SK', 'Чеджу эс-кей', 'Jeju SK'), stadium: t('', '', '', '') },
	{ key: 'daejeon', name: t('Daejeon Hana Citizen', '대전 하나 시티즌', 'Тэджон Хана Ситизен', 'Tejon Xana Sitizen'), stadium: t('', '', '', '') },
];

export type FixtureKind = 'league' | 'cup' | 'charity';

export interface DemoFixture {
	home: ClubKey;
	away: ClubKey;
	kind: FixtureKind;
}

const clubOf = (key: ClubKey): DemoClub => DEMO_CLUBS.find((club) => club.key === key);

/** the venue of the home club of a fixture (throws for a club without a home ground in the demo data) */
export const getFixtureVenue = (fixture: DemoFixture): VenueKey => {
	const venue = clubOf(fixture.home).homeVenue;
	if (!venue) throw new Error(`${fixture.home} has no home ground in the demo data`);
	return venue;
};

/** the disclaimer every football description carries, in every language */
export const FIXTURE_DISCLAIMER: Localized = t(
	'Demo listing, not an official fixture.',
	'데모용 목록이며 공식 경기가 아닙니다.',
	'Демонстрационная афиша, не официальный матч.',
	"Demo e'lon, rasmiy o'yin emas.",
);

const KIND_TITLE: Record<FixtureKind, Localized> = {
	league: t('', '', '', ''),
	cup: t('Cup Semi-Final: ', '컵 준결승: ', 'Полуфинал кубка: ', 'Kubok yarim finali: '),
	charity: t('Charity Match: ', '자선 경기: ', 'Благотворительный матч: ', "Xayriya o'yini: "),
};

const fixtureBase = (id: string, home: ClubKey, away: ClubKey, kind: FixtureKind): DemoBase => {
	const fixture: DemoFixture = { home, away, kind };
	const h = clubOf(home);
	const a = clubOf(away);
	const title = t(
		`${KIND_TITLE[kind].en}${h.name.en} vs ${a.name.en}`,
		`${KIND_TITLE[kind].ko}${h.name.ko} 대 ${a.name.ko}`,
		`${KIND_TITLE[kind].ru}${h.name.ru} — ${a.name.ru}`,
		`${KIND_TITLE[kind].uz}${h.name.uz} — ${a.name.uz}`,
	);
	const extra: Record<FixtureKind, Localized> = {
		league: t('A fictional league match day.', '가상의 리그 경기입니다.', 'Вымышленный матч лиги.', "Xayoliy liga o'yini."),
		cup: t('A fictional cup semi-final: one match decides who plays in the final.', '가상의 컵대회 준결승입니다. 단판 승부로 결승 진출팀이 가려집니다.', 'Вымышленный полуфинал кубка: один матч решает, кто выйдет в финал.', "Xayoliy kubok yarim finali: finalga yo'llanma bitta o'yinda hal bo'ladi."),
		charity: t('A fictional charity match; all proceeds would go to children sports programs.', '가상의 자선 경기입니다. 수익금은 어린이 스포츠 프로그램에 기부될 예정입니다.', 'Вымышленный благотворительный матч: все средства пошли бы на детские спортивные программы.', "Xayoliy xayriya o'yini: barcha mablag' bolalar sport dasturlariga berilardi."),
	};
	const venue = h.stadium;
	const desc = t(
		`${FIXTURE_DISCLAIMER.en} ${h.name.en} host ${a.name.en} at ${venue.en}. ${extra[kind].en}`,
		`${FIXTURE_DISCLAIMER.ko} ${h.name.ko} 대 ${a.name.ko}, 장소: ${venue.ko}. ${extra[kind].ko}`,
		`${FIXTURE_DISCLAIMER.ru} ${h.name.ru} принимает ${a.name.ru}, ${venue.ru}. ${extra[kind].ru}`,
		`${FIXTURE_DISCLAIMER.uz} ${h.name.uz} mezbon, mehmon: ${a.name.uz}, ${venue.uz}. ${extra[kind].uz}`,
	);
	return base(id, FOOTBALL, title, desc, fixture);
};

/** one invented match per football event of the plan (the ids are used by `demo-plan.ts`) */
export const DEMO_FIXTURE_BASES: DemoBase[] = [
	fixtureBase('fx-seoul-jeonbuk', 'seoul', 'jeonbuk', 'league'),
	fixtureBase('fx-incheon-ulsan', 'incheon', 'ulsan', 'league'),
	fixtureBase('fx-gwangju-pohang', 'gwangju', 'pohang', 'league'),
	fixtureBase('fx-seoul-daejeon', 'seoul', 'daejeon', 'league'),
	fixtureBase('fx-incheon-seoul', 'incheon', 'seoul', 'league'),
	fixtureBase('fx-gwangju-jeju-cup', 'gwangju', 'jeju', 'cup'),
	fixtureBase('charity', 'seoul', 'gwangju', 'charity'),
	fixtureBase('fx-incheon-jeju', 'incheon', 'jeju', 'league'),
	fixtureBase('fx-gwangju-ulsan', 'gwangju', 'ulsan', 'league'),
	fixtureBase('fx-seoul-pohang', 'seoul', 'pohang', 'league'),
	fixtureBase('fx-incheon-jeonbuk', 'incheon', 'jeonbuk', 'league'),
	fixtureBase('fx-seoul-ulsan', 'seoul', 'ulsan', 'league'),
	fixtureBase('fx-gwangju-daejeon', 'gwangju', 'daejeon', 'league'),
	fixtureBase('fx-incheon-pohang', 'incheon', 'pohang', 'league'),
];

export const DEMO_BASES: DemoBase[] = [
	base('lanterns', CONCERT,
		t('Dalbit Parade Live', '달빛 퍼레이드 라이브', 'Dalbit Parade: живой концерт', 'Dalbit Parade jonli konserti'),
		t('An evening of dreamy indie rock with the band Dalbit Parade and songs from their new album.',
			'밴드 달빛 퍼레이드와 함께하는 몽환적인 인디 록의 밤. 새 앨범 수록곡을 라이브로 들려드립니다.',
			'Вечер мечтательного инди-рока с группой Dalbit Parade и песнями из нового альбома.',
			"Dalbit Parade guruhi bilan orzuli indi-rok oqshomi, yangi albomdagi qo'shiqlar jonli ijroda.")),
	base('symphony', CONCERT,
		t('Cheongmyeong Symphony Spring Gala', '청명 심포니 봄 갈라', 'Весенний гала Cheongmyeong Symphony', 'Cheongmyeong Symphony bahorgi galasi'),
		t('The Cheongmyeong Symphony Orchestra plays masterpieces by Beethoven and Dvorak in a spring gala.',
			'청명 심포니 오케스트라가 베토벤과 드보르자크의 명곡을 연주하는 봄맞이 갈라 콘서트입니다.',
			'Оркестр Cheongmyeong Symphony исполняет шедевры Бетховена и Дворжака на весеннем гала-концерте.',
			"Cheongmyeong Symphony orkestri bahorgi galada Betxoven va Dvorjak durdonalarini ijro etadi.")),
	base('jazz', CONCERT,
		t('Yeoreum Jazz Trio: Late Night Sessions', '여름 재즈 트리오: 심야 세션', 'Yeoreum Jazz Trio: ночные сессии', 'Yeoreum Jazz Trio: tungi sessiyalar'),
		t('Live jazz with the Yeoreum Jazz Trio and guest players, going on until midnight.',
			'여름 재즈 트리오와 게스트 연주자들의 라이브 재즈 세션이 자정까지 이어집니다.',
			'Живой джаз от Yeoreum Jazz Trio и приглашённых музыкантов до полуночи.',
			"Yeoreum Jazz Trio va mehmon musiqachilarining tungacha davom etadigan jonli jaz chiqishlari.")),
	base('rockfest', CONCERT,
		t('Hanyeoreum Rock Festival', '한여름 록 페스티벌', 'Рок-фестиваль Hanyeoreum', 'Hanyeoreum rok festivali'),
		t('A midsummer rock festival: twelve bands on two stages, from sunset until late at night.',
			'한여름 밤을 달구는 록 페스티벌. 두 개의 무대에서 12팀의 밴드가 해 질 녘부터 늦은 밤까지 공연합니다.',
			'Рок-фестиваль в разгар лета: 12 групп на двух сценах, от заката до поздней ночи.',
			"Yoz o'rtasidagi rok festivali: ikki sahnada 12 ta guruh, quyosh botgandan kech tungacha.")),
	base('acoustic', CONCERT,
		t('Quiet Night Acoustic Evening', '고요한 밤 어쿠스틱 이브닝', 'Акустический вечер «Тихая ночь»', "«Sokin tun» akustik oqshomi"),
		t('A warm acoustic evening with five independent singer-songwriters.',
			'다섯 팀의 인디 싱어송라이터가 들려주는 따뜻한 어쿠스틱 라이브 무대입니다.',
			'Тёплый акустический вечер: пять независимых авторов-исполнителей.',
			"Beshta mustaqil qo'shiqchi-muallifning iliq akustik jonli kechasi.")),
	base('electronic', CONCERT,
		t('Neon Hangang: Electronic Night', '네온 한강: 일렉트로닉 나이트', 'Neon Hangang: электронная ночь', 'Neon Hangang: elektron kecha'),
		t('Four DJs, one dance floor and visuals that follow the beat until the early morning.',
			'네 명의 DJ와 하나의 댄스 플로어, 새벽까지 비트를 따라가는 영상 연출을 만나보세요.',
			'Четыре диджея, один танцпол и визуальные эффекты в такт музыке до самого утра.',
			"To'rtta DJ, bitta raqs maydoni va ertalabgacha ritmga mos vizual effektlar.")),
	base('gugak', CONCERT,
		t('Sori Garden: Gugak Fusion Night', '소리정원: 국악 퓨전 나이트', 'Sori Garden: вечер фьюжн гугак', 'Sori Garden: gugak fyujn kechasi'),
		t('The Sori Garden ensemble mixes traditional Korean instruments with modern arrangements in a night of fusion music.',
			'소리정원 앙상블이 전통 국악기와 현대적인 편곡을 섞어 들려주는 퓨전 음악의 밤입니다.',
			'Ансамбль Sori Garden сочетает традиционные корейские инструменты и современные аранжировки в вечере фьюжн-музыки.',
			"Sori Garden ansambli an'anaviy koreys cholg'ulari va zamonaviy aranjirovkalarni uyg'unlashtiradigan fyujn kechasi.")),
	base('choir', CONCERT,
		t('Snowflake Chorale Winter Concert', '눈꽃 합창단 겨울 콘서트', 'Зимний концерт хора Snowflake', 'Snowflake xorining qishki konserti'),
		t('The Snowflake Chorale, a choir of eighty voices, sings winter songs from around the world.',
			'80명의 눈꽃 합창단이 전 세계의 겨울 노래를 들려드립니다.',
			'Хор Snowflake Chorale из восьмидесяти голосов исполняет зимние песни со всего мира.',
			"Snowflake Chorale xori sakson ovoz bilan dunyoning qishki qo'shiqlarini ijro etadi.")),
	base('pop', CONCERT,
		t('Haneul Seven Pop Night', '하늘 세븐 팝 나이트', 'Поп-вечер Haneul Seven', 'Haneul Seven pop kechasi'),
		t('The pop group Haneul Seven brings its first full concert with dancers and a live band.',
			'팝 그룹 하늘 세븐의 첫 단독 콘서트. 댄서와 라이브 밴드가 함께합니다.',
			'Поп-группа Haneul Seven даёт первый полноценный концерт с танцорами и живой группой.',
			"Haneul Seven pop guruhining raqqosalar va jonli guruh bilan birinchi to'liq konserti.")),
	base('latenight', COMEDY,
		t('Late Night Stand-Up with Oh Jae-mi', '오재미의 심야 스탠드업', 'Ночной стендап с О Джэ-ми', "O Jae-mi bilan tungi stend-ap"),
		t('A late night stand-up show with the comedian Oh Jae-mi and three guests.',
			'코미디언 오재미와 게스트 세 명이 함께하는 심야 스탠드업 쇼입니다.',
			'Ночное стендап-шоу с комиком О Джэ-ми и тремя гостями.',
			"Komik O Jae-mi va uchta mehmon ishtirokidagi tungi stend-ap shou.")),
	base('rising', COMEDY,
		t('Daehangno Rising Stars Comedy Showcase', '대학로 라이징 스타 코미디 쇼케이스', 'Шоукейс молодых комиков «Тэханно»', 'Daehangno yosh komiklar shoukeysi'),
		t('A showcase of up-and-coming comedians from the Daehangno theater scene on one stage.',
			'대학로에서 활동하는 떠오르는 신인 코미디언들의 무대를 한자리에서 만나는 쇼케이스입니다.',
			'Шоукейс начинающих комиков театрального квартала Тэханно на одной сцене.',
			"Daehangno teatr muhitidagi yangi komiklarning chiqishlari bir sahnada.")),
	base('improv', COMEDY,
		t('Improv Battle: Team Kimchi vs Team Bibimbap', '즉흥 코미디 배틀: 팀 김치 대 팀 비빔밥', 'Битва импровизации: команда «Кимчи» против команды «Пибимпап»', "Improv jangi: «Kimchi» jamoasi va «Bibimbap» jamoasi"),
		t('Two improv teams, suggestions from the audience and no script at all.',
			'두 개의 즉흥 코미디 팀이 관객의 제안만으로 무대를 만듭니다. 대본은 없습니다.',
			'Две команды импровизаторов, подсказки из зала и никакого сценария.',
			"Ikki improv jamoasi, tomoshabinlar takliflari va umuman ssenariysiz.")),
	base('bilingual', COMEDY,
		t('Bilingual Stand-Up: Korean & English', '바이링궐 스탠드업: 한국어 & 영어', 'Двуязычный стендап: корейский и английский', "Ikki tilli stend-ap: koreys va ingliz"),
		t('Stand-up in two languages, so visitors and locals laugh at the same jokes.',
			'두 가지 언어로 진행되어 방문객과 현지인이 같은 농담에 함께 웃을 수 있는 스탠드업입니다.',
			'Стендап на двух языках: гости и местные смеются над одними и теми же шутками.',
			"Ikki tilda stend-ap: mehmonlar va mahalliy aholi bir xil hazillarga kuladi.")),
	base('webtoon', OTHER,
		t('Webtoon Creators Talk & Meetup', '웹툰 작가 토크 & 밋업', 'Встреча с авторами вебтунов', 'Vebtun mualliflari bilan uchrashuv'),
		t('A talk session and fan meetup with three popular webtoon creators.',
			'인기 웹툰 작가 세 명과 함께하는 토크 세션과 팬 밋업 행사입니다.',
			'Беседа и встреча с фанатами вместе с тремя популярными авторами вебтунов.',
			"Uchta mashhur vebtun muallifi bilan suhbat va muxlislar uchrashuvi.")),
	base('esports', OTHER,
		t('Esports Weekend Finals', 'e스포츠 위켄드 결승전', 'Финалы киберспортивного уикенда', 'Esport dam olish kunlari finali'),
		t('The finals of a two day esports tournament with live crowds and fan events.',
			'주말 이틀간 열리는 e스포츠 대회의 결승전입니다. 현장 응원과 팬 이벤트가 함께합니다.',
			'Финалы двухдневного киберспортивного турнира с болельщиками и фан-активностями.',
			"Ikki kunlik esport turnirining finali, muxlislar va maxsus tadbirlar bilan.")),
	base('vinyl', OTHER,
		t('Hongdae Vinyl & Craft Market', '홍대 바이닐 & 크래프트 마켓', 'Ярмарка винила и ремёсел «Хондэ»', 'Hongdae vinil va hunarmandchilik bozori'),
		t('Records, handmade goods and street food from more than sixty independent sellers.',
			'60여 개 독립 셀러의 LP, 수공예품, 길거리 음식을 만나는 마켓입니다.',
			'Пластинки, изделия ручной работы и стритфуд от более чем шестидесяти независимых продавцов.',
			"Oltmishdan ortiq mustaqil sotuvchining plastinkalari, qo'l mehnati buyumlari va ko'cha taomlari.")),
	base('founders', OTHER,
		t('Founders Night: Startup Talks', '파운더스 나이트: 스타트업 토크', 'Вечер основателей: стартап-доклады', "Asoschilar kechasi: startap suhbatlari"),
		t('Five founders tell what worked, what failed and what they would do differently.',
			'다섯 명의 창업가가 성공과 실패, 그리고 다시 한다면 달리 할 일을 이야기합니다.',
			'Пять основателей рассказывают, что сработало, что нет и что они сделали бы иначе.',
			"Beshta asoschi nima ish bergani, nima bermagani va nimani boshqacha qilishini aytib beradi.")),
	base('indiegame', OTHER,
		t('Daegu Indie Game Expo', '대구 인디 게임 엑스포', 'Выставка инди-игр в Тэгу', "Tegu indi o'yinlar ko'rgazmasi"),
		t('Forty small studios show games you can play on the spot, with talks by the developers.',
			'40개의 소규모 스튜디오가 현장에서 바로 즐길 수 있는 게임을 선보이며 개발자 토크도 진행됩니다.',
			'Сорок небольших студий показывают игры, в которые можно сыграть на месте, и проводят доклады.',
			"Qirqta kichik studiya joyida o'ynash mumkin bo'lgan o'yinlarni ko'rsatadi, dasturchilar suhbatlari bilan.")),
	...DEMO_FIXTURE_BASES,
];

/** COMMENTS written by buyers (one per language); the organizer answers with a @nick prefix because comments have no replies */

export const DEMO_COMMENTS: Localized[] = [
	t('Booked my tickets already, cannot wait!', '벌써 예매했어요! 너무 기대돼요.', 'Уже купил билеты, очень жду!', 'Chiptalarni oldim, juda kutyapman!'),
	t('Can a group of six sit together?', '6명이 함께 앉을 수 있을까요?', 'Можно ли сесть рядом компанией из шести человек?', "Olti kishilik guruh yonma-yon o'tira oladimi?"),
	t('Great line-up for the price.', '가격 대비 구성이 정말 좋네요.', 'За такую цену программа отличная.', 'Narxiga nisbatan dastur ajoyib.'),
	t('I went last time and the sound was fantastic.', '지난번에도 갔는데 음향이 최고였어요.', 'В прошлый раз звук был великолепный.', "O'tgan safar tovush juda yaxshi edi."),
	t('What time do the doors open?', '입장은 몇 시부터인가요?', 'Во сколько открываются двери?', 'Eshiklar soat nechada ochiladi?'),
	t('Is the venue easy to reach by subway?', '지하철로 가기 편한 곳인가요?', 'Удобно ли добираться до зала на метро?', "Zalga metro bilan borish qulaymi?"),
	t('Is there a student discount?', '학생 할인이 있나요?', 'Есть ли скидка для студентов?', 'Talabalar uchun chegirma bormi?'),
	t('Bringing my parents, are the seats comfortable?', '부모님과 함께 가요. 좌석은 편한가요?', 'Иду с родителями, удобные ли там места?', "Ota-onam bilan boraman, o'rindiqlar qulaymi?"),
	t('The first show was a blast, booking again.', '지난 공연이 정말 즐거웠어서 또 예매했어요.', 'Прошлое шоу было потрясающим, беру снова.', "Oldingi shou ajoyib edi, yana band qildim."),
	t('Please add more dates!', '공연 일정을 더 추가해 주세요!', 'Добавьте, пожалуйста, больше дат!', "Iltimos, ko'proq sanalar qo'shing!"),
	t('Will there be an English translation?', '영어 통역이 제공되나요?', 'Будет ли перевод на английский?', "Inglizcha tarjima bo'ladimi?"),
	t('Does the ticket include a drink?', '티켓에 음료가 포함되어 있나요?', 'В билет входит напиток?', 'Chiptaga ichimlik kiradimi?'),
];
export const DEMO_REPLIES: Localized = t(
	'Thank you for asking! Seats in one row are sold side by side, and doors open one hour before the start.',
	'문의 감사합니다! 같은 열 좌석은 나란히 판매되며, 입장은 시작 1시간 전부터입니다.',
	'Спасибо за вопрос! Места в одном ряду продаются рядом, двери открываются за час до начала.',
	"Savol uchun rahmat! Bir qatordagi o'rindiqlar yonma-yon sotiladi, eshiklar boshlanishidan bir soat oldin ochiladi.",
);

/** names of records that the seed is not allowed to delete but the check reports as probable QA data (never touched) */
export const QA_NAME_PATTERNS: RegExp[] = [/^zz[\s_-]/i, /clash\s*test/i, /\bqa[\s_-]?(test|data)\b/i, /^test[\s_-]/i];
