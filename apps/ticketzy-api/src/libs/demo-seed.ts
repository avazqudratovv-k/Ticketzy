/**
 * Pure parts of `npm run seed:demo`: the production guard, the demo accounts, the venue and event data, the cleanup
 * and the run order. Nothing here talks to Nest, so it can be unit tested; the services are driven from seed-demo.ts.
 *
 * Demo data is recognised by the fixed email domain of its members: every demo document hangs off one of those
 * members (events by organizerId, venues by memberId, orders by buyerId, ...), so no `demoSeed` field is needed on the schemas.
 */
import { EventCategory, EventStatus, SeatingType, SectionKind, SectionSpacing, VenueType } from './enums/event.enum';
import { MemberType } from './enums/member.enum';
import { TicketCurrency } from './enums/ticket.enum';
import { VenueLayoutSection } from './venue-layout';

export const DEMO_EMAIL_DOMAIN = 'ticketzy.demo';
export const DEMO_EMAIL_PATTERN = /@ticketzy\.demo$/i;
export const DEFAULT_DEMO_PASSWORD = 'Demo1234!';
export const DEMO_PASSWORD_ENV = 'DEMO_PASSWORD';
const MIN_PASSWORD_LENGTH = 8;

/** Refuses to run in production unless ALLOW_DEMO_SEED=true is set on purpose. */
export const assertDemoSeedAllowed = (env: Record<string, string | undefined> = process.env): void => {
	if (env.NODE_ENV === 'production' && String(env.ALLOW_DEMO_SEED ?? '').trim().toLowerCase() !== 'true') {
		throw new Error('Refusing to seed demo data when NODE_ENV=production. Set ALLOW_DEMO_SEED=true if you really mean it.');
	}
};

/** DEMO_PASSWORD, or the documented default. It is a demo password, never a secret. */
export const getDemoPassword = (env: Record<string, string | undefined> = process.env): string => {
	const password = env[DEMO_PASSWORD_ENV]?.trim() || DEFAULT_DEMO_PASSWORD;
	if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`${DEMO_PASSWORD_ENV} must be at least ${MIN_PASSWORD_LENGTH} characters`);
	return password;
};

export const demoEmail = (name: string): string => `${name}@${DEMO_EMAIL_DOMAIN}`;

export interface DemoAccount {
	key: 'buyer' | 'crowd' | 'organizer' | 'pending' | 'rejected';
	email: string;
	nick: string;
	fullName: string;
	memberType: MemberType;
	desc?: string;
	/** the admin action that brings the account to its final status; PENDING organizers stay as signed up */
	outcome?: 'verify' | 'reject';
	rejectReason?: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
	{ key: 'buyer', email: demoEmail('buyer'), nick: 'demo_buyer', fullName: 'Min-jun Kim', memberType: MemberType.USER },
	// fills the seat maps and the sales numbers; nobody is expected to log in as this account
	{ key: 'crowd', email: demoEmail('crowd'), nick: 'demo_crowd', fullName: 'Demo Crowd', memberType: MemberType.USER },
	{
		key: 'organizer',
		email: demoEmail('organizer'),
		nick: 'hanbit_live',
		fullName: 'Hanbit Live Entertainment',
		memberType: MemberType.ORGANIZER,
		desc: 'Concerts, football matches and comedy nights across Seoul, Incheon and Busan.',
		outcome: 'verify',
	},
	{
		key: 'pending',
		email: demoEmail('pending'),
		nick: 'new_stage',
		fullName: 'New Stage Productions',
		memberType: MemberType.ORGANIZER,
		desc: 'A new organizer waiting for admin approval.',
	},
	{
		key: 'rejected',
		email: demoEmail('rejected'),
		nick: 'ghost_tickets',
		fullName: 'Ghost Tickets Co.',
		memberType: MemberType.ORGANIZER,
		desc: 'An organizer whose application was declined.',
		outcome: 'reject',
		rejectReason: 'We could not verify your business registration. Please contact support with the registration certificate.',
	},
];

/** placeholder pictures from a public image service */
export const demoImage = (slug: string, width = 1200, height = 800): string => `https://picsum.photos/seed/ticketzy-${slug}/${width}/${height}`;

/** VENUES: a stadium (seated sections plus standing), a concert hall and a small comedy club */

export interface DemoVenue {
	key: 'stadium' | 'hall' | 'club';
	name: string;
	type: VenueType;
	city: string;
	address: string;
	coordinates: [number, number];
	sections: VenueLayoutSection[];
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

// x and y place the section on a 1000 x 700 canvas, the stage or pitch in the middle
export const DEMO_VENUES: DemoVenue[] = [
	{
		key: 'stadium',
		name: 'Harbor Sky Stadium',
		type: VenueType.STADIUM,
		city: 'Incheon',
		address: '100 Haneul-ro, Jung-gu, Incheon',
		coordinates: [126.7052, 37.4563],
		sections: [
			section('PITCH', 'Standing Pitch', SectionKind.STANDING, 1, 1, 500, 350, 0, SectionSpacing.COMPACT, { capacity: 1200 }),
			section('VIP_W', 'Premium West', SectionKind.SEATED, 4, 16, 130, 350, 270, SectionSpacing.WIDE, { tierKey: 'VIP' }),
			section('LOWER_N', 'Lower North', SectionKind.SEATED, 8, 20, 500, 110, 0, SectionSpacing.NORMAL, { tierKey: 'GOLD' }),
			section('LOWER_S', 'Lower South', SectionKind.SEATED, 8, 20, 500, 590, 180, SectionSpacing.NORMAL, { tierKey: 'GOLD' }),
			section('UPPER_E', 'Upper East', SectionKind.SEATED, 10, 24, 880, 350, 90, SectionSpacing.COMPACT, { tierKey: 'STANDARD' }),
			section('UPPER_W', 'Upper West', SectionKind.SEATED, 10, 24, 20, 350, 270, SectionSpacing.COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'hall',
		name: 'Hanbit Concert Hall',
		type: VenueType.HALL,
		city: 'Seoul',
		address: '25 Hanbit-daero, Mapo-gu, Seoul',
		coordinates: [126.9236, 37.5547],
		sections: [
			section('BOX', 'Side Boxes', SectionKind.SEATED, 3, 8, 90, 300, 270, SectionSpacing.WIDE, { tierKey: 'VIP' }),
			section('ORCH_L', 'Orchestra Left', SectionKind.SEATED, 12, 10, 330, 300, 0, SectionSpacing.NORMAL, { tierKey: 'PREMIUM' }),
			section('ORCH_R', 'Orchestra Right', SectionKind.SEATED, 12, 10, 670, 300, 0, SectionSpacing.NORMAL, { tierKey: 'PREMIUM' }),
			section('BALCONY', 'Balcony', SectionKind.SEATED, 6, 24, 500, 560, 0, SectionSpacing.COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'club',
		name: 'Laugh Cellar Comedy Club',
		type: VenueType.CLUB,
		city: 'Busan',
		address: '8 Cellar-gil, Haeundae-gu, Busan',
		coordinates: [129.1604, 35.1587],
		sections: [
			section('FRONT', 'Front Tables', SectionKind.SEATED, 3, 8, 500, 250, 0, SectionSpacing.WIDE, { tierKey: 'FRONT' }),
			section('BACK', 'Back Rows', SectionKind.SEATED, 4, 10, 500, 450, 0, SectionSpacing.NORMAL, { tierKey: 'STANDARD' }),
		],
	},
];

/** EVENTS */

export type DemoLocale = 'en' | 'ko' | 'ru' | 'uz';

export interface DemoTicketType {
	name: string;
	price: number;
	maxPerOrder: number;
	/** RESERVED events: links the ticket type to the SEATED sections of that tier (the quantity comes from the seats) */
	tierKey?: string;
	/** GENERAL events only */
	quantity?: number;
}

export interface DemoEvent {
	key: string;
	venue: DemoVenue['key'];
	category: EventCategory;
	seating: SeatingType;
	status: EventStatus;
	/** days from the moment the seed runs; the ENDED event is moved into the past after its sales */
	daysFromNow: number;
	/** start hour in UTC (Seoul is UTC+9) */
	startHourUtc: number;
	durationHours: number;
	title: string;
	desc: string;
	translations: Record<DemoLocale, { title: string; description: string }>;
	ticketTypes: DemoTicketType[];
	/** REJECTED and CANCELLED events */
	reason?: string;
	/** how many paid orders the filler buyer places before the event is closed (8 seats, or 4 tickets, each) */
	crowdOrders: number;
}

const concertTiers = (vip: number, premium: number, standard: number): DemoTicketType[] => [
	{ name: 'VIP Box', price: vip, maxPerOrder: 8, tierKey: 'VIP' },
	{ name: 'Premium Orchestra', price: premium, maxPerOrder: 8, tierKey: 'PREMIUM' },
	{ name: 'Standard Balcony', price: standard, maxPerOrder: 8, tierKey: 'STANDARD' },
];

const matchTiers = (vip: number, gold: number, standard: number): DemoTicketType[] => [
	{ name: 'Premium West', price: vip, maxPerOrder: 8, tierKey: 'VIP' },
	{ name: 'Lower Tier', price: gold, maxPerOrder: 8, tierKey: 'GOLD' },
	{ name: 'Upper Tier', price: standard, maxPerOrder: 8, tierKey: 'STANDARD' },
];

const comedyTiers = (front: number, standard: number): DemoTicketType[] => [
	{ name: 'Front Table', price: front, maxPerOrder: 6, tierKey: 'FRONT' },
	{ name: 'Back Row', price: standard, maxPerOrder: 6, tierKey: 'STANDARD' },
];

export const DEMO_EVENTS: DemoEvent[] = [
	{
		key: 'comedy-busan-late-night',
		venue: 'club',
		category: EventCategory.COMEDY,
		seating: SeatingType.RESERVED,
		status: EventStatus.APPROVED,
		daysFromNow: 31,
		startHourUtc: 11,
		durationHours: 2,
		title: 'Busan Late Night Stand-Up',
		desc: 'A late night stand-up show with four of the most popular comedians in Busan.',
		translations: {
			en: { title: 'Busan Late Night Stand-Up', description: 'A late night stand-up show with four of the most popular comedians in Busan.' },
			ko: { title: '부산 심야 스탠드업', description: '부산의 인기 코미디언 네 명이 나서는 심야 스탠드업 코미디 쇼입니다.' },
			ru: { title: 'Ночной стендап в Пусане', description: 'Ночное стендап-шоу с участием четырёх популярных комиков Пусана.' },
			uz: { title: 'Pusan tungi stend-ap', description: "Pusanning to'rtta mashhur komigi ishtirokidagi tungi stend-ap shou." },
		},
		ticketTypes: comedyTiers(45000, 33000),
		crowdOrders: 3,
	},
	{
		key: 'concert-hanbit-symphony',
		venue: 'hall',
		category: EventCategory.CONCERT,
		seating: SeatingType.RESERVED,
		status: EventStatus.APPROVED,
		daysFromNow: 36,
		startHourUtc: 10,
		durationHours: 3,
		title: 'Hanbit Spring Symphony Gala',
		desc: 'A spring orchestra gala at Hanbit Concert Hall with masterpieces by Beethoven and Dvorak.',
		translations: {
			en: { title: 'Hanbit Spring Symphony Gala', description: 'A spring orchestra gala at Hanbit Concert Hall with masterpieces by Beethoven and Dvorak.' },
			ko: { title: '한빛 봄 심포니 갈라', description: '한빛 콘서트홀에서 펼쳐지는 봄맞이 오케스트라 갈라 콘서트. 베토벤과 드보르자크의 명곡을 연주합니다.' },
			ru: { title: 'Весенний симфонический гала Hanbit', description: 'Весенний гала-концерт оркестра в зале Hanbit. В программе произведения Бетховена и Дворжака.' },
			uz: { title: 'Hanbit bahorgi simfonik galasi', description: "Hanbit konsert zalida bahorgi orkestr galasi. Dasturda Betxoven va Dvorjak asarlari." },
		},
		ticketTypes: concertTiers(165000, 121000, 77000),
		crowdOrders: 6,
	},
	{
		key: 'football-incheon-seoul',
		venue: 'stadium',
		category: EventCategory.FOOTBALL,
		seating: SeatingType.RESERVED,
		status: EventStatus.APPROVED,
		daysFromNow: 33,
		startHourUtc: 6,
		durationHours: 2,
		title: 'Incheon FC vs Seoul United',
		desc: 'The league leaders meet at Harbor Sky Stadium in the match of the season.',
		translations: {
			en: { title: 'Incheon FC vs Seoul United', description: 'The league leaders meet at Harbor Sky Stadium in the match of the season.' },
			ko: { title: '인천 FC 대 서울 유나이티드', description: '리그 선두권을 가를 빅매치. 하버 스카이 스타디움에서 킥오프합니다.' },
			ru: { title: 'Инчхон ФК — Сеул Юнайтед', description: 'Матч лидеров лиги. Стартовый свисток на стадионе Harbor Sky.' },
			uz: { title: 'Inchhon FK — Seul Yunayted', description: "Liga yetakchilari o'rtasidagi katta o'yin. Boshlanish Harbor Sky stadionida." },
		},
		ticketTypes: matchTiers(85000, 45000, 22000),
		crowdOrders: 12,
	},
	{
		key: 'concert-harbor-rock',
		venue: 'stadium',
		category: EventCategory.CONCERT,
		seating: SeatingType.GENERAL,
		status: EventStatus.APPROVED,
		daysFromNow: 45,
		startHourUtc: 9,
		durationHours: 6,
		title: 'Harbor Sky Summer Rock Festival',
		desc: 'The biggest summer rock festival of the year at Harbor Sky Stadium, with twelve bands on two stages.',
		translations: {
			en: { title: 'Harbor Sky Summer Rock Festival', description: 'The biggest summer rock festival of the year at Harbor Sky Stadium, with twelve bands on two stages.' },
			ko: { title: '하버 스카이 섬머 록 페스티벌', description: '인천 하버 스카이 스타디움에서 열리는 여름 최대의 록 페스티벌. 국내외 밴드 12팀이 무대에 오릅니다.' },
			ru: { title: 'Летний рок-фестиваль Harbor Sky', description: 'Крупнейший летний рок-фестиваль на стадионе Harbor Sky в Инчхоне: 12 групп из Кореи и других стран.' },
			uz: { title: 'Harbor Sky yozgi rok festivali', description: "Inchhondagi Harbor Sky stadionida o'tadigan yilning eng katta yozgi rok festivali: 12 ta guruh sahnaga chiqadi." },
		},
		ticketTypes: [
			{ name: 'Standing', price: 99000, maxPerOrder: 6, quantity: 1000 },
			{ name: 'Reserved Seat Zone', price: 132000, maxPerOrder: 6, quantity: 600 },
			{ name: 'VIP Fan Zone', price: 198000, maxPerOrder: 4, quantity: 100 },
		],
		crowdOrders: 8,
	},
	{
		key: 'other-webtoon-talk',
		venue: 'hall',
		category: EventCategory.OTHER,
		seating: SeatingType.GENERAL,
		status: EventStatus.APPROVED,
		daysFromNow: 52,
		startHourUtc: 5,
		durationHours: 3,
		title: 'Webtoon Creators Talk & Meetup',
		desc: 'A talk session and fan meetup with three popular webtoon creators.',
		translations: {
			en: { title: 'Webtoon Creators Talk & Meetup', description: 'A talk session and fan meetup with three popular webtoon creators.' },
			ko: { title: '웹툰 작가 토크 & 밋업', description: '인기 웹툰 작가 세 명과 함께하는 토크 세션과 팬 밋업 행사입니다.' },
			ru: { title: 'Встреча с авторами вебтунов', description: 'Беседа и встреча с фанатами вместе с тремя популярными авторами вебтунов.' },
			uz: { title: 'Vebtun mualliflari bilan uchrashuv', description: 'Uchta mashhur vebtun muallifi bilan suhbat va muxlislar uchrashuvi.' },
		},
		ticketTypes: [
			{ name: 'General Admission', price: 25000, maxPerOrder: 6, quantity: 300 },
			{ name: 'Meet & Greet Add-on', price: 60000, maxPerOrder: 2, quantity: 40 },
		],
		crowdOrders: 5,
	},
	{
		key: 'concert-kindie-acoustic',
		venue: 'hall',
		category: EventCategory.CONCERT,
		seating: SeatingType.RESERVED,
		status: EventStatus.APPROVED,
		daysFromNow: 58,
		startHourUtc: 10,
		durationHours: 3,
		title: 'K-Indie Acoustic Evening',
		desc: 'A warm acoustic evening with five independent musicians from Seoul.',
		translations: {
			en: { title: 'K-Indie Acoustic Evening', description: 'A warm acoustic evening with five independent musicians from Seoul.' },
			ko: { title: 'K-인디 어쿠스틱 이브닝', description: '서울의 인디 뮤지션 다섯 팀이 들려주는 따뜻한 어쿠스틱 라이브 무대입니다.' },
			ru: { title: 'Акустический вечер K-Indie', description: 'Тёплый акустический вечер: пять независимых исполнителей из Сеула.' },
			uz: { title: 'K-Indie akustik oqshomi', description: "Seuldagi beshta mustaqil musiqachining iliq akustik jonli kechasi." },
		},
		ticketTypes: concertTiers(110000, 88000, 55000),
		crowdOrders: 4,
	},
	{
		key: 'football-harbor-cup',
		venue: 'stadium',
		category: EventCategory.FOOTBALL,
		seating: SeatingType.RESERVED,
		status: EventStatus.APPROVED,
		daysFromNow: 75,
		startHourUtc: 6,
		durationHours: 2,
		title: 'Harbor Cup Semi-Final',
		desc: 'The semi-final of the Harbor Cup: one match decides who plays in the final.',
		translations: {
			en: { title: 'Harbor Cup Semi-Final', description: 'The semi-final of the Harbor Cup: one match decides who plays in the final.' },
			ko: { title: '하버 컵 준결승', description: '하버 컵 토너먼트 준결승전. 결승 진출을 향한 단판 승부입니다.' },
			ru: { title: 'Полуфинал Кубка Harbor', description: 'Полуфинал кубкового турнира: один матч решает, кто выйдет в финал.' },
			uz: { title: 'Harbor kubogi yarim finali', description: "Kubok turnirining yarim finali: finalga yo'llanma bir o'yinda hal bo'ladi." },
		},
		ticketTypes: matchTiers(70000, 38000, 18000),
		crowdOrders: 7,
	},
	{
		key: 'concert-midnight-jazz',
		venue: 'hall',
		category: EventCategory.CONCERT,
		seating: SeatingType.RESERVED,
		status: EventStatus.PENDING,
		daysFromNow: 65,
		startHourUtc: 12,
		durationHours: 3,
		title: 'Midnight Jazz Sessions',
		desc: 'Live jazz sessions with a trio and guest players, going on until midnight.',
		translations: {
			en: { title: 'Midnight Jazz Sessions', description: 'Live jazz sessions with a trio and guest players, going on until midnight.' },
			ko: { title: '미드나잇 재즈 세션', description: '자정까지 이어지는 재즈 트리오와 게스트 연주자들의 라이브 세션입니다.' },
			ru: { title: 'Полуночные джазовые сессии', description: 'Живые джазовые сессии с трио и приглашёнными музыкантами до полуночи.' },
			uz: { title: 'Yarim tun jaz sessiyalari', description: "Tungacha davom etadigan jaz triosi va mehmon musiqachilarining jonli chiqishlari." },
		},
		ticketTypes: concertTiers(95000, 72000, 48000),
		crowdOrders: 0,
	},
	{
		key: 'comedy-laugh-cellar-anniversary',
		venue: 'club',
		category: EventCategory.COMEDY,
		seating: SeatingType.RESERVED,
		status: EventStatus.PENDING,
		daysFromNow: 82,
		startHourUtc: 11,
		durationHours: 2,
		title: 'Laugh Cellar Anniversary Special',
		desc: 'An anniversary comedy show with a special line-up to celebrate three years of the club.',
		translations: {
			en: { title: 'Laugh Cellar Anniversary Special', description: 'An anniversary comedy show with a special line-up to celebrate three years of the club.' },
			ko: { title: '라프 셀러 개관 기념 스페셜', description: '개관 3주년을 기념하는 특별 라인업 코미디 쇼입니다.' },
			ru: { title: 'Юбилейный спецвыпуск Laugh Cellar', description: 'Юбилейное комедийное шоу к трёхлетию клуба со специальным составом.' },
			uz: { title: 'Laugh Cellar yubiley maxsus shousi', description: "Klubning uch yilligiga bag'ishlangan maxsus tarkibli komediya shousi." },
		},
		ticketTypes: comedyTiers(50000, 38000),
		crowdOrders: 0,
	},
	{
		key: 'other-esports-finals',
		venue: 'stadium',
		category: EventCategory.OTHER,
		seating: SeatingType.GENERAL,
		status: EventStatus.DRAFT,
		daysFromNow: 88,
		startHourUtc: 5,
		durationHours: 8,
		title: 'Esports Weekend Finals',
		desc: 'The finals of a two day esports tournament with live crowds and fan events.',
		translations: {
			en: { title: 'Esports Weekend Finals', description: 'The finals of a two day esports tournament with live crowds and fan events.' },
			ko: { title: 'e스포츠 위켄드 결승전', description: '주말 이틀간 열리는 e스포츠 대회의 결승전입니다. 현장 응원과 팬 이벤트가 함께합니다.' },
			ru: { title: 'Финалы киберспортивного уикенда', description: 'Финалы двухдневного киберспортивного турнира с болельщиками и фан-активностями.' },
			uz: { title: 'Esport dam olish kunlari finali', description: "Ikki kunlik esport turnirining finali, muxlislar va maxsus tadbirlar bilan." },
		},
		ticketTypes: [{ name: 'Day Pass', price: 35000, maxPerOrder: 6, quantity: 2000 }],
		crowdOrders: 0,
	},
	{
		key: 'football-charity-legends',
		venue: 'stadium',
		category: EventCategory.FOOTBALL,
		seating: SeatingType.RESERVED,
		status: EventStatus.REJECTED,
		daysFromNow: 50,
		startHourUtc: 7,
		durationHours: 2,
		title: 'Charity Legends Match',
		desc: 'A charity football match with retired legends.',
		translations: {
			en: { title: 'Charity Legends Match', description: 'A charity football match with retired legends.' },
			ko: { title: '자선 레전드 매치', description: '은퇴한 레전드 선수들이 함께하는 자선 축구 경기입니다.' },
			ru: { title: 'Благотворительный матч легенд', description: 'Благотворительный футбольный матч с участием ветеранов.' },
			uz: { title: "Xayriya afsonalar o'yini", description: "Faxriy futbolchilar ishtirokidagi xayriya o'yini." },
		},
		ticketTypes: matchTiers(30000, 20000, 10000),
		reason: 'The description is too short and the line-up is missing. Please add the confirmed players and the charity partner, then resubmit.',
		crowdOrders: 0,
	},
	{
		key: 'concert-winter-ballad',
		venue: 'hall',
		category: EventCategory.CONCERT,
		seating: SeatingType.GENERAL,
		status: EventStatus.CANCELLED,
		daysFromNow: 40,
		startHourUtc: 10,
		durationHours: 3,
		title: 'Winter Ballad Tour: Hanbit',
		desc: 'The Seoul stop of a winter ballad concert tour.',
		translations: {
			en: { title: 'Winter Ballad Tour: Hanbit', description: 'The Seoul stop of a winter ballad concert tour.' },
			ko: { title: '겨울 발라드 투어: 한빛', description: '겨울 감성의 발라드 콘서트 투어 서울 공연입니다.' },
			ru: { title: 'Зимний тур баллад: Hanbit', description: 'Концерт зимнего тура баллад в Сеуле.' },
			uz: { title: 'Qishki ballada turi: Hanbit', description: "Qishki ballada konsert turining Seuldagi chiqishi." },
		},
		ticketTypes: [{ name: 'General Admission', price: 88000, maxPerOrder: 4, quantity: 200 }],
		reason: 'The headline artist is unavailable because of illness. All tickets are refunded in full.',
		crowdOrders: 2,
	},
	{
		key: 'comedy-spring-showcase',
		venue: 'club',
		category: EventCategory.COMEDY,
		seating: SeatingType.RESERVED,
		status: EventStatus.ENDED,
		daysFromNow: 31,
		startHourUtc: 11,
		durationHours: 2,
		title: 'Spring Stand-Up Showcase',
		desc: 'A showcase of up-and-coming comedians on one stage.',
		translations: {
			en: { title: 'Spring Stand-Up Showcase', description: 'A showcase of up-and-coming comedians on one stage.' },
			ko: { title: '스프링 스탠드업 쇼케이스', description: '신인 코미디언들의 무대를 한자리에서 만나는 쇼케이스입니다.' },
			ru: { title: 'Весенний стендап-шоукейс', description: 'Шоукейс начинающих комиков на одной сцене.' },
			uz: { title: 'Bahorgi stend-ap shoukeysi', description: "Yangi komiklarning chiqishlari bir sahnada." },
		},
		ticketTypes: comedyTiers(40000, 28000),
		crowdOrders: 2,
	},
];

/** how many days before now the ENDED event is moved to once its tickets are sold and one is checked in */
export const ENDED_EVENT_DAYS_AGO = 14;

/** SEAT BLOCKS for the filler buyer, so the seat map shows groups of sold seats spread over every section */

export interface DemoSeat {
	_id: unknown;
	sectionKey: string;
	row: number;
	number: number;
}

/**
 * Picks `sizes.length` blocks of neighbouring seats (same section and row, consecutive numbers), taking the sections
 * in turn and skipping rows so the sold seats do not form one solid patch. Deterministic, never reuses a seat.
 * A block is at most `maxSize` seats; fewer blocks come back when the free seats run out.
 */
export const pickSeatBlocks = (seats: DemoSeat[], sizes: number[], maxSize = 8): unknown[][] => {
	const bySection = new Map<string, Map<number, DemoSeat[]>>();
	for (const seat of seats) {
		const rows = bySection.get(seat.sectionKey) ?? new Map<number, DemoSeat[]>();
		rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
		bySection.set(seat.sectionKey, rows);
	}
	const sections = [...bySection.keys()].sort().map((key) => ({
		rows: [...bySection.get(key)].sort(([a], [b]) => a - b).map(([, rowSeats]) => rowSeats.sort((a, b) => a.number - b.number)),
	}));

	if (!sections.length) return [];

	const used = new Set<unknown>();
	const blocks: unknown[][] = [];
	sizes.forEach((wanted, index) => {
		const size = Math.max(1, Math.min(wanted, maxSize));
		const section = sections[index % sections.length];
		const round = Math.floor(index / sections.length);
		for (let attempt = 0; attempt < section.rows.length; attempt++) {
			const rowSeats = section.rows[(round * 3 + 1 + attempt) % section.rows.length].filter((seat) => !used.has(seat._id));
			// the first run of consecutive free seats that is long enough, entered a little way in
			for (let start = 0; start + size <= rowSeats.length; start++) {
				const run = rowSeats.slice(start, start + size);
				if (run.every((seat, i) => seat.number === run[0].number + i)) {
					const shifted = Math.min(start + ((round * 2) % 3), rowSeats.length - size);
					const chosen = rowSeats.slice(shifted, shifted + size);
					if (!chosen.every((seat, i) => seat.number === chosen[0].number + i)) break;
					chosen.forEach((seat) => used.add(seat._id));
					blocks.push(chosen.map((seat) => seat._id));
					return;
				}
			}
		}
	});
	return blocks;
};

/** CLEANUP */

/** the little of a Mongoose model that the cleanup needs, so tests can use an in-memory stand-in */
export interface DemoCleanupModel {
	find(filter: any): any;
	deleteMany(filter: any): any;
}

export interface DemoCleanupModels {
	member: DemoCleanupModel;
	venue: DemoCleanupModel;
	event: DemoCleanupModel;
	ticketType: DemoCleanupModel;
	eventSeat: DemoCleanupModel;
	order: DemoCleanupModel;
	ticket: DemoCleanupModel;
	payment: DemoCleanupModel;
	refund: DemoCleanupModel;
	conversation: DemoCleanupModel;
	message: DemoCleanupModel;
	notification: DemoCleanupModel;
	auditLog: DemoCleanupModel;
}

export type DemoCounts = Record<string, number>;

const idsOf = (docs: { _id: unknown }[]): unknown[] => docs.map((doc) => doc._id);

/**
 * Removes what an earlier `seed:demo` created, and nothing else: every document that belongs to a member with a
 * @ticketzy.demo address (their events and venues, the orders, tickets, payments and refunds of those events and
 * buyers, conversations and messages, notifications and audit entries about them) and those members themselves.
 * ADMIN members are never removed, whatever their address.
 */
export const removeDemoData = async (models: DemoCleanupModels): Promise<DemoCounts> => {
	const members = await models.member.find({ memberEmail: DEMO_EMAIL_PATTERN, memberType: { $ne: MemberType.ADMIN } }).lean().exec();
	const memberIds = idsOf(members);
	if (!memberIds.length) return { members: 0 };

	const [events, venues, conversations] = await Promise.all([
		models.event.find({ organizerId: { $in: memberIds } }).lean().exec(),
		models.venue.find({ memberId: { $in: memberIds } }).lean().exec(),
		models.conversation.find({ organizerId: { $in: memberIds } }).lean().exec(),
	]);
	const eventIds = idsOf(events);
	const orders = await models.order.find({ $or: [{ buyerId: { $in: memberIds } }, { eventId: { $in: eventIds } }] }).lean().exec();
	const orderIds = idsOf(orders);
	const conversationIds = idsOf(conversations);

	const removed: DemoCounts = {};
	const remove = async (name: string, model: DemoCleanupModel, filter: any): Promise<void> => {
		const result = await model.deleteMany(filter).exec();
		removed[name] = result?.deletedCount ?? 0;
	};

	// children first, so a run that dies half way leaves members behind and the next run finds the rest again
	await remove('tickets', models.ticket, { $or: [{ orderId: { $in: orderIds } }, { eventId: { $in: eventIds } }] });
	await remove('payments', models.payment, { orderId: { $in: orderIds } });
	await remove('refunds', models.refund, { $or: [{ orderId: { $in: orderIds } }, { eventId: { $in: eventIds } }] });
	await remove('eventSeats', models.eventSeat, { eventId: { $in: eventIds } });
	await remove('orders', models.order, { _id: { $in: orderIds } });
	await remove('ticketTypes', models.ticketType, { eventId: { $in: eventIds } });
	await remove('messages', models.message, { conversationId: { $in: conversationIds } });
	await remove('conversations', models.conversation, { _id: { $in: conversationIds } });
	await remove('notifications', models.notification, {
		$or: [
			{ receiverId: { $in: memberIds } },
			{ authorId: { $in: memberIds } },
			{ eventId: { $in: eventIds } },
			{ orderId: { $in: orderIds } },
			{ conversationId: { $in: conversationIds } },
		],
	});
	await remove('auditLogs', models.auditLog, {
		$or: [{ actorId: { $in: memberIds } }, { targetId: { $in: [...memberIds, ...eventIds, ...orderIds] } }],
	});
	await remove('events', models.event, { _id: { $in: eventIds } });
	await remove('venues', models.venue, { _id: { $in: idsOf(venues) } });
	await remove('members', models.member, { _id: { $in: memberIds } });
	return removed;
};

/** RUN ORDER AND SUMMARY */

export interface DemoSummary {
	emails: { label: string; email: string }[];
	counts: DemoCounts;
}

/** guard first, then remove the earlier demo data, then create it again; running twice leaves one copy */
export const runDemoSeed = async (steps: {
	env?: Record<string, string | undefined>;
	cleanup: () => Promise<DemoCounts>;
	create: () => Promise<DemoSummary>;
}): Promise<{ removed: DemoCounts; summary: DemoSummary }> => {
	assertDemoSeedAllowed(steps.env ?? process.env);
	const removed = await steps.cleanup();
	const summary = await steps.create();
	return { removed, summary };
};

/** logins by email only and the NAME of the password variable; the password itself is never printed */
export const formatDemoSummary = (summary: DemoSummary, removed: DemoCounts = {}): string => {
	const lines = ['', 'Demo data is ready.'];
	const removedTotal = Object.values(removed).reduce((sum, count) => sum + count, 0);
	if (removedTotal) lines.push(`Removed ${removedTotal} document(s) of the earlier demo run first.`);
	lines.push('', 'Created:');
	for (const [name, count] of Object.entries(summary.counts)) lines.push(`  ${name.padEnd(14)} ${count}`);
	lines.push('', 'Demo logins:');
	for (const { label, email } of summary.emails) lines.push(`  ${label.padEnd(20)} ${email}`);
	lines.push(
		'',
		`Password of the demo accounts: the value of ${DEMO_PASSWORD_ENV} (default in docs/ai/COMPLETED_TASKS.md).`,
		'The admin keeps its own ADMIN_PASSWORD from `npm run seed`.',
		'',
	);
	return lines.join('\n');
};
