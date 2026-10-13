/**
 * Static content of the demo seed: names, venues, event texts. Everything is fictional (no real artists, teams, celebrities
 * or trademarks); only the cities are real. Texts exist in en, ko, ru and uz, the locales the app stores translations for.
 */
import { EventCategory, SectionKind, SectionSpacing, VenueType } from './enums/event.enum';
import { VenueLayoutSection } from './venue-layout';

export type DemoLocale = 'en' | 'ko' | 'ru' | 'uz';
export const DEMO_LOCALES: DemoLocale[] = ['en', 'ko', 'ru', 'uz'];
export type Localized = Record<DemoLocale, string>;

/** deterministic placeholder pictures from a public image service; external URLs only, nothing is written to disk */
export const demoImage = (slug: string, width = 1200, height = 800): string => `https://picsum.photos/seed/ticketzy-${slug}/${width}/${height}`;

/** ORGANIZERS */

export type OrganizerKey = 'hanbit' | 'mirae' | 'harbor' | 'cellar' | 'camellia' | 'nomad' | 'neon' | 'jeju' | 'pending' | 'rejected';

export interface DemoOrganizer {
	key: OrganizerKey;
	email: string;
	nick: string;
	fullName: string;
	address: string;
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
		fullName: 'Hanbit Live Entertainment',
		address: '25 Hanbit-daero, Mapo-gu, Seoul',
		desc: 'Concerts, football matches and comedy nights across Seoul, Incheon and Busan. Organizing live events since 2019.',
		outcome: 'verify',
	},
	{
		key: 'mirae',
		email: 'mirae.stage@ticketzy.demo',
		nick: 'mirae_stage',
		fullName: 'Mirae Stage Company',
		address: '12 Theater-ro, Jeonju, Jeonbuk',
		desc: 'A small company that brings jazz, folk and pop artists to regional theaters.',
		outcome: 'verify',
	},
	{
		key: 'harbor',
		email: 'harbor.sports@ticketzy.demo',
		nick: 'harbor_sports',
		fullName: 'Harbor Sports Promotions',
		address: '3 Stadium-ro, Jung-gu, Incheon',
		desc: 'Match day tickets for league and cup football in the Seoul metropolitan area.',
		outcome: 'verify',
	},
	{
		key: 'cellar',
		email: 'laugh.cellar@ticketzy.demo',
		nick: 'laugh_cellar',
		fullName: 'Laugh Cellar Productions',
		address: '8 Cellar-gil, Haeundae-gu, Busan',
		desc: 'Stand-up and improv every week. Bilingual shows for visitors and locals.',
		outcome: 'verify',
	},
	{
		key: 'camellia',
		email: 'camellia.arts@ticketzy.demo',
		nick: 'camellia_arts',
		fullName: 'Camellia Arts Collective',
		address: '77 Culture-gil, Dong-gu, Daejeon',
		desc: 'Talks, markets and expos for creators: webtoon, vinyl, indie games and more.',
		outcome: 'verify',
	},
	{
		key: 'nomad',
		email: 'silkroad.culture@ticketzy.demo',
		nick: 'silkroad_culture',
		fullName: 'Silk Road Culture Group',
		address: '41 Hanbit-ro, Yeonsu-gu, Incheon',
		desc: 'Cultural evenings and festivals for the Central Asian and Russian-speaking community in Korea.',
		outcome: 'verify',
	},
	{
		key: 'neon',
		email: 'neon.alley@ticketzy.demo',
		nick: 'neon_alley',
		fullName: 'Neon Alley Events',
		address: '19 Alley-gil, Mapo-gu, Seoul',
		desc: 'Electronic and pop nights in small live houses.',
		outcome: 'verify',
	},
	{
		key: 'jeju',
		email: 'tangerine.fest@ticketzy.demo',
		nick: 'tangerine_fest',
		fullName: 'Tangerine Island Festivals',
		address: '5 Seaside-ro, Jeju-si, Jeju',
		desc: 'Concerts and festivals on Jeju Island, all year round.',
		outcome: 'verify',
	},
	{
		key: 'pending',
		email: 'pending@ticketzy.demo',
		nick: 'new_stage',
		fullName: 'New Stage Productions',
		address: '102 Gongwon-ro, Nam-gu, Ulsan',
		desc: 'A new organizer waiting for admin approval.',
	},
	{
		key: 'rejected',
		email: 'rejected@ticketzy.demo',
		nick: 'ghost_tickets',
		fullName: 'Ghost Tickets Co.',
		address: '9 Station-ro, Dongnae-gu, Busan',
		desc: 'An organizer whose application was declined.',
		outcome: 'reject',
		rejectReason: 'We could not verify your business registration. Please contact support with the registration certificate.',
	},
];

/** BUYERS: the first one is the demo buyer; names are mixed Korean, English, Russian and Uzbek */

export interface DemoBuyer {
	email: string;
	nick: string;
	fullName: string;
}

const buyer = (fullName: string, slug: string): DemoBuyer => ({
	email: `${slug}@ticketzy.demo`,
	nick: slug.replace(/\./g, '_'),
	fullName,
});

export const DEMO_BUYERS: DemoBuyer[] = [
	buyer('Min-jun Kim', 'buyer'),
	// Korean
	buyer('김서연', 'seoyeon.kim'),
	buyer('이도윤', 'doyun.lee'),
	buyer('박지우', 'jiwoo.park'),
	buyer('최하은', 'haeun.choi'),
	buyer('정시우', 'siwoo.jung'),
	buyer('강예린', 'yerin.kang'),
	buyer('조현우', 'hyunwoo.jo'),
	buyer('윤서아', 'seoa.yoon'),
	buyer('장민재', 'minjae.jang'),
	buyer('임지민', 'jimin.lim'),
	buyer('한유진', 'yujin.han'),
	buyer('오태양', 'taeyang.oh'),
	buyer('서나연', 'nayeon.seo'),
	buyer('신동현', 'donghyun.shin'),
	// English
	buyer('Emily Carter', 'emily.carter'),
	buyer('James Walker', 'james.walker'),
	buyer('Olivia Bennett', 'olivia.bennett'),
	buyer('Daniel Murphy', 'daniel.murphy'),
	buyer('Hannah Brooks', 'hannah.brooks'),
	buyer('Liam Foster', 'liam.foster'),
	buyer('Grace Holloway', 'grace.holloway'),
	buyer('Noah Whitfield', 'noah.whitfield'),
	buyer('Chloe Ramsey', 'chloe.ramsey'),
	buyer('Ethan Caldwell', 'ethan.caldwell'),
	buyer('Megan Fraser', 'megan.fraser'),
	buyer('Lucas Hartley', 'lucas.hartley'),
	// Russian
	buyer('Иван Петров', 'ivan.petrov'),
	buyer('Анна Смирнова', 'anna.smirnova'),
	buyer('Дмитрий Кузнецов', 'dmitry.kuznetsov'),
	buyer('Екатерина Волкова', 'ekaterina.volkova'),
	buyer('Сергей Морозов', 'sergey.morozov'),
	buyer('Ольга Новикова', 'olga.novikova'),
	buyer('Алексей Соколов', 'alexey.sokolov'),
	buyer('Мария Лебедева', 'maria.lebedeva'),
	buyer('Николай Орлов', 'nikolay.orlov'),
	buyer('Татьяна Егорова', 'tatyana.egorova'),
	buyer('Артём Фёдоров', 'artem.fedorov'),
	buyer('Виктория Макарова', 'viktoria.makarova'),
	// Uzbek
	buyer('Dilshod Karimov', 'dilshod.karimov'),
	buyer('Malika Yusupova', 'malika.yusupova'),
	buyer('Jasur Rahimov', 'jasur.rahimov'),
	buyer('Nodira Abdullayeva', 'nodira.abdullayeva'),
	buyer('Sardor Tursunov', 'sardor.tursunov'),
	buyer('Gulnora Ismoilova', 'gulnora.ismoilova'),
	buyer('Bobur Mirzayev', 'bobur.mirzayev'),
	buyer('Zilola Saidova', 'zilola.saidova'),
	buyer('Otabek Normatov', 'otabek.normatov'),
	buyer('Madina Qodirova', 'madina.qodirova'),
	buyer('Aziz Umarov', 'aziz.umarov'),
];

/** VENUES: ten venues in ten Korean cities; the layouts sit on a 1000 x 700 canvas, the stage or pitch in the middle */

export type VenueKey = 'hall' | 'stadium' | 'club' | 'playhouse' | 'arena' | 'expo' | 'openair' | 'fortress' | 'livehouse' | 'jeju';

export interface DemoVenue {
	key: VenueKey;
	name: string;
	type: VenueType;
	city: string;
	address: string;
	coordinates: [number, number];
	owner: OrganizerKey;
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

const { SEATED, STANDING } = SectionKind;
const { COMPACT, NORMAL, WIDE } = SectionSpacing;

export const DEMO_VENUES: DemoVenue[] = [
	{
		key: 'hall',
		name: 'Hanbit Concert Hall',
		type: VenueType.HALL,
		city: 'Seoul',
		address: '25 Hanbit-daero, Mapo-gu, Seoul',
		coordinates: [126.9236, 37.5547],
		owner: 'hanbit',
		sections: [
			section('BOX', 'Side Boxes', SEATED, 3, 8, 90, 300, 270, WIDE, { tierKey: 'VIP' }),
			section('ORCH_L', 'Orchestra Left', SEATED, 12, 10, 330, 300, 0, NORMAL, { tierKey: 'PREMIUM' }),
			section('ORCH_R', 'Orchestra Right', SEATED, 12, 10, 670, 300, 0, NORMAL, { tierKey: 'PREMIUM' }),
			section('BALCONY', 'Balcony', SEATED, 6, 24, 500, 560, 0, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'stadium',
		name: 'Harbor Sky Stadium',
		type: VenueType.STADIUM,
		city: 'Incheon',
		address: '100 Haneul-ro, Jung-gu, Incheon',
		coordinates: [126.7052, 37.4563],
		owner: 'harbor',
		sections: [
			section('PITCH', 'Standing Pitch', STANDING, 1, 1, 500, 350, 0, COMPACT, { capacity: 1200 }),
			section('VIP_W', 'Premium West', SEATED, 4, 16, 130, 350, 270, WIDE, { tierKey: 'VIP' }),
			section('LOWER_N', 'Lower North', SEATED, 8, 20, 500, 110, 0, NORMAL, { tierKey: 'GOLD' }),
			section('LOWER_S', 'Lower South', SEATED, 8, 20, 500, 590, 180, NORMAL, { tierKey: 'GOLD' }),
			section('UPPER_E', 'Upper East', SEATED, 10, 24, 880, 350, 90, COMPACT, { tierKey: 'STANDARD' }),
			section('UPPER_W', 'Upper West', SEATED, 10, 24, 20, 350, 270, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'club',
		name: 'Laugh Cellar Comedy Club',
		type: VenueType.CLUB,
		city: 'Busan',
		address: '8 Cellar-gil, Haeundae-gu, Busan',
		coordinates: [129.1604, 35.1587],
		owner: 'cellar',
		sections: [
			section('FRONT', 'Front Tables', SEATED, 3, 8, 500, 250, 0, WIDE, { tierKey: 'FRONT' }),
			section('BACK', 'Back Rows', SEATED, 4, 10, 500, 450, 0, NORMAL, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'playhouse',
		name: 'Hanok Madang Playhouse',
		type: VenueType.THEATER,
		city: 'Jeonju',
		address: '12 Theater-ro, Wansan-gu, Jeonju',
		coordinates: [127.1531, 35.8153],
		owner: 'mirae',
		sections: [
			section('STALLS', 'Stalls', SEATED, 6, 10, 500, 260, 0, NORMAL, { tierKey: 'PREMIUM' }),
			section('CIRCLE', 'Upper Circle', SEATED, 6, 12, 500, 500, 0, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'arena',
		name: 'Dalseong Arena',
		type: VenueType.HALL,
		city: 'Daegu',
		address: '240 Arena-ro, Dalseo-gu, Daegu',
		coordinates: [128.5328, 35.8289],
		owner: 'camellia',
		sections: [
			section('FLOOR', 'Standing Floor', STANDING, 1, 1, 500, 350, 0, COMPACT, { capacity: 900 }),
			section('EAST', 'East Stand', SEATED, 8, 20, 860, 350, 90, NORMAL, { tierKey: 'GOLD' }),
			section('WEST', 'West Stand', SEATED, 8, 20, 140, 350, 270, NORMAL, { tierKey: 'GOLD' }),
			section('NORTH', 'North Stand', SEATED, 6, 16, 500, 90, 0, COMPACT, { tierKey: 'STANDARD' }),
			section('SOUTH', 'South Stand', SEATED, 6, 16, 500, 610, 180, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'expo',
		name: 'Expo Garden Hall',
		type: VenueType.HALL,
		city: 'Daejeon',
		address: '77 Culture-gil, Yuseong-gu, Daejeon',
		coordinates: [127.3845, 36.3504],
		owner: 'camellia',
		sections: [
			section('FLOOR', 'Open Floor', STANDING, 1, 1, 500, 360, 0, COMPACT, { capacity: 400 }),
			section('LEFT', 'Left Seating', SEATED, 8, 12, 150, 360, 270, NORMAL, { tierKey: 'PREMIUM' }),
			section('RIGHT', 'Right Seating', SEATED, 8, 12, 850, 360, 90, NORMAL, { tierKey: 'PREMIUM' }),
			section('GALLERY', 'Gallery', SEATED, 5, 20, 500, 600, 0, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'openair',
		name: 'Mudeung Open Air Stage',
		type: VenueType.OPEN_AIR,
		city: 'Gwangju',
		address: '15 Park-ro, Buk-gu, Gwangju',
		coordinates: [126.9117, 35.1796],
		owner: 'nomad',
		sections: [
			section('PIT', 'Front Pit', STANDING, 1, 1, 500, 200, 0, COMPACT, { capacity: 400 }),
			section('LAWN', 'Lawn', STANDING, 1, 1, 500, 480, 0, COMPACT, { capacity: 2000 }),
		],
	},
	{
		key: 'fortress',
		name: 'Fortress Football Ground',
		type: VenueType.STADIUM,
		city: 'Suwon',
		address: '88 Seongbyeok-ro, Paldal-gu, Suwon',
		coordinates: [127.0286, 37.2636],
		owner: 'harbor',
		sections: [
			section('BOX', 'Directors Box', SEATED, 3, 12, 500, 90, 0, WIDE, { tierKey: 'VIP' }),
			section('EAST', 'East Stand', SEATED, 10, 30, 880, 350, 90, NORMAL, { tierKey: 'GOLD' }),
			section('WEST', 'West Stand', SEATED, 10, 30, 120, 350, 270, NORMAL, { tierKey: 'GOLD' }),
			section('SOUTH', 'South Terrace', SEATED, 8, 30, 500, 610, 180, COMPACT, { tierKey: 'STANDARD' }),
		],
	},
	{
		key: 'livehouse',
		name: 'Neon Alley Live House',
		type: VenueType.CLUB,
		city: 'Seoul',
		address: '19 Alley-gil, Mapo-gu, Seoul',
		coordinates: [126.9239, 37.5563],
		owner: 'neon',
		sections: [
			section('STANDING', 'Standing Floor', STANDING, 1, 1, 500, 380, 0, COMPACT, { capacity: 350 }),
			section('LOUNGE', 'Balcony Lounge', SEATED, 3, 14, 500, 120, 0, WIDE, { tierKey: 'VIP' }),
		],
	},
	{
		key: 'jeju',
		name: 'Hallasan Culture Center',
		type: VenueType.HALL,
		city: 'Jeju',
		address: '5 Seaside-ro, Jeju-si, Jeju',
		coordinates: [126.5312, 33.4996],
		owner: 'jeju',
		sections: [
			section('ORCH', 'Orchestra', SEATED, 8, 14, 500, 300, 0, NORMAL, { tierKey: 'PREMIUM' }),
			section('BALCONY', 'Balcony', SEATED, 5, 14, 500, 560, 0, COMPACT, { tierKey: 'STANDARD' }),
		],
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
	jeju: [120, 30],
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
	[EventCategory.CONCERT]: 66000,
	[EventCategory.FOOTBALL]: 22000,
	[EventCategory.COMEDY]: 33000,
	[EventCategory.OTHER]: 25000,
};

/** EVENT BASES: texts in four languages; an edition number (language neutral) tells repeated shows apart */

export interface DemoBase {
	id: string;
	category: EventCategory;
	title: Localized;
	desc: Localized;
}

const base = (id: string, category: EventCategory, title: Localized, desc: Localized): DemoBase => ({ id, category, title, desc });
const t = (en: string, ko: string, ru: string, uz: string): Localized => ({ en, ko, ru, uz });
const { CONCERT, FOOTBALL, COMEDY, OTHER } = EventCategory;

export const DEMO_BASES: DemoBase[] = [
	base('lanterns', CONCERT,
		t('Midnight Lanterns Live', '미드나잇 랜턴즈 라이브', 'Midnight Lanterns: живой концерт', 'Midnight Lanterns jonli konserti'),
		t('An evening of dreamy indie rock with the band Midnight Lanterns and songs from their new album.',
			'밴드 미드나잇 랜턴즈와 함께하는 몽환적인 인디 록의 밤. 새 앨범 수록곡을 라이브로 들려드립니다.',
			'Вечер мечтательного инди-рока с группой Midnight Lanterns и песнями из нового альбома.',
			"Midnight Lanterns guruhi bilan orzuli indi-rok oqshomi, yangi albomdagi qo'shiqlar jonli ijroda.")),
	base('symphony', CONCERT,
		t('Spring Symphony Gala', '봄 심포니 갈라', 'Весенний симфонический гала', 'Bahorgi simfonik gala'),
		t('A spring orchestra gala with masterpieces by Beethoven and Dvorak.',
			'베토벤과 드보르자크의 명곡을 연주하는 봄맞이 오케스트라 갈라 콘서트입니다.',
			'Весенний гала-концерт оркестра: произведения Бетховена и Дворжака.',
			"Bahorgi orkestr galasi: Betxoven va Dvorjak durdonalari.")),
	base('jazz', CONCERT,
		t('Late Night Jazz Sessions', '심야 재즈 세션', 'Ночные джазовые сессии', 'Tungi jaz sessiyalari'),
		t('Live jazz with a trio and guest players, going on until midnight.',
			'자정까지 이어지는 재즈 트리오와 게스트 연주자들의 라이브 세션입니다.',
			'Живой джаз в исполнении трио и приглашённых музыкантов до полуночи.',
			"Tungacha davom etadigan jaz triosi va mehmon musiqachilarining jonli chiqishlari.")),
	base('rockfest', CONCERT,
		t('Summer Rock Festival', '섬머 록 페스티벌', 'Летний рок-фестиваль', 'Yozgi rok festivali'),
		t('The biggest summer rock festival of the year: twelve bands on two stages.',
			'올여름 최대 규모의 록 페스티벌. 두 개의 무대에서 12팀의 밴드가 공연합니다.',
			'Крупнейший летний рок-фестиваль года: 12 групп на двух сценах.',
			"Yilning eng katta yozgi rok festivali: ikki sahnada 12 ta guruh.")),
	base('acoustic', CONCERT,
		t('Acoustic Evening with Five Singers', '다섯 가수의 어쿠스틱 이브닝', 'Акустический вечер с пятью исполнителями', 'Beshta xonanda bilan akustik oqshom'),
		t('A warm acoustic evening with five independent singer-songwriters.',
			'다섯 팀의 인디 싱어송라이터가 들려주는 따뜻한 어쿠스틱 라이브 무대입니다.',
			'Тёплый акустический вечер: пять независимых авторов-исполнителей.',
			"Beshta mustaqil qo'shiqchi-muallifning iliq akustik jonli kechasi.")),
	base('electronic', CONCERT,
		t('Electric Tide: Electronic Night', '일렉트릭 타이드: 일렉트로닉 나이트', 'Electric Tide: электронная ночь', 'Electric Tide: elektron kecha'),
		t('Four DJs, one dance floor and visuals that follow the beat until the early morning.',
			'네 명의 DJ와 하나의 댄스 플로어, 새벽까지 비트를 따라가는 영상 연출을 만나보세요.',
			'Четыре диджея, один танцпол и визуальные эффекты в такт музыке до самого утра.',
			"To'rtta DJ, bitta raqs maydoni va ertalabgacha ritmga mos vizual effektlar.")),
	base('gugak', CONCERT,
		t('Gugak Fusion Night', '국악 퓨전 나이트', 'Вечер фьюжн гугак', 'Gugak fyujn kechasi'),
		t('Traditional Korean instruments meet modern arrangements in a night of fusion music.',
			'전통 국악기와 현대적인 편곡이 만나는 퓨전 음악의 밤입니다.',
			'Традиционные корейские инструменты и современные аранжировки в вечере фьюжн-музыки.',
			"An'anaviy koreys cholg'ulari va zamonaviy aranjirovkalar uchrashadigan fyujn kechasi.")),
	base('choir', CONCERT,
		t('Winter Choir Concert', '겨울 합창 콘서트', 'Зимний хоровой концерт', 'Qishki xor konserti'),
		t('A choir of eighty voices sings winter songs from around the world.',
			'80명의 합창단이 전 세계의 겨울 노래를 들려드립니다.',
			'Хор из восьмидесяти голосов исполняет зимние песни со всего мира.',
			"Sakson ovozli xor dunyoning qishki qo'shiqlarini ijro etadi.")),
	base('pop', CONCERT,
		t('Aurora Seven Pop Night', '오로라 세븐 팝 나이트', 'Поп-вечер Aurora Seven', 'Aurora Seven pop kechasi'),
		t('The pop group Aurora Seven brings its first full concert with dancers and a live band.',
			'팝 그룹 오로라 세븐의 첫 단독 콘서트. 댄서와 라이브 밴드가 함께합니다.',
			'Поп-группа Aurora Seven даёт первый полноценный концерт с танцорами и живой группой.',
			"Aurora Seven pop guruhining raqqosalar va jonli guruh bilan birinchi to'liq konserti.")),
	base('derby1', FOOTBALL,
		t('Incheon Harbor FC vs Seoul Meridian', '인천 하버 FC 대 서울 메리디안', 'Инчхон Харбор — Сеул Меридиан', 'Inchhon Harbor — Seul Meridian'),
		t('The league leaders meet in the match of the season.',
			'리그 선두권을 가를 시즌 최고의 빅매치입니다.',
			'Лидеры лиги встречаются в главном матче сезона.',
			"Liga yetakchilari mavsumning eng katta o'yinida uchrashadi.")),
	base('derby2', FOOTBALL,
		t('Suwon Fortress vs Daegu Falcons', '수원 포트리스 대 대구 팰컨스', 'Сувон Фортресс — Тэгу Фэлконс', 'Suvon Fortress — Tegu Falcons'),
		t('A fast and physical match between two sides fighting for a place in the cup.',
			'컵대회 진출을 놓고 맞붙는 두 팀의 빠르고 치열한 승부입니다.',
			'Быстрый и жёсткий матч двух команд, борющихся за место в кубке.',
			"Kubokka yo'llanma uchun kurashayotgan ikki jamoaning tezkor va keskin o'yini.")),
	base('derby3', FOOTBALL,
		t('Busan Tide vs Daejeon Comets', '부산 타이드 대 대전 코메츠', 'Пусан Тайд — Тэджон Комитс', 'Pusan Tide — Tejon Comets'),
		t('The coastal side hosts the comets in a match under the floodlights.',
			'바닷가 팀과 대전의 맞대결. 조명 아래 펼쳐지는 야간 경기입니다.',
			'Команда с побережья принимает «Комитс» в матче под прожекторами.',
			"Qirg'oq jamoasi Comets bilan projektorlar ostida o'ynaydi.")),
	base('derby4', FOOTBALL,
		t('Gwangju Lions vs Jeju Tangerines', '광주 라이언스 대 제주 탠저린스', 'Кванджу Лайонс — Чеджу Тэнджеринс', 'Kvanju Lions — Cheju Tangerines'),
		t('Two attacking teams, one evening, plenty of goals expected.',
			'공격적인 두 팀이 만나는 저녁, 많은 골이 기대되는 경기입니다.',
			'Две атакующие команды в один вечер: ожидается много голов.',
			"Hujumkor ikki jamoa bir oqshomda uchrashadi, ko'p gol kutilmoqda.")),
	base('cup', FOOTBALL,
		t('Harbor Cup Semi-Final', '하버 컵 준결승', 'Полуфинал Кубка Harbor', 'Harbor kubogi yarim finali'),
		t('The semi-final of the Harbor Cup: one match decides who plays in the final.',
			'하버 컵 토너먼트 준결승전. 결승 진출을 향한 단판 승부입니다.',
			'Полуфинал Кубка Harbor: один матч решает, кто выйдет в финал.',
			"Harbor kubogi yarim finali: finalga yo'llanma bitta o'yinda hal bo'ladi.")),
	base('charity', FOOTBALL,
		t('Charity Legends Match', '자선 레전드 매치', 'Благотворительный матч ветеранов', "Xayriya faxriylar o'yini"),
		t('A charity football match with retired players. All proceeds go to children sports programs.',
			'은퇴한 선수들이 함께하는 자선 축구 경기입니다. 수익금은 어린이 스포츠 프로그램에 기부됩니다.',
			'Благотворительный матч с участием ветеранов. Все средства идут на детские спортивные программы.',
			"Faxriy futbolchilar ishtirokidagi xayriya o'yini. Barcha mablag' bolalar sport dasturlariga beriladi.")),
	base('latenight', COMEDY,
		t('Late Night Stand-Up', '심야 스탠드업', 'Ночной стендап', 'Tungi stend-ap'),
		t('A late night stand-up show with four of the funniest comedians in town.',
			'도시에서 가장 웃긴 코미디언 네 명이 나서는 심야 스탠드업 쇼입니다.',
			'Ночное стендап-шоу с четырьмя самыми смешными комиками города.',
			"Shaharning eng kulgili to'rtta komigi ishtirokidagi tungi stend-ap shou.")),
	base('rising', COMEDY,
		t('Rising Stars Comedy Showcase', '라이징 스타 코미디 쇼케이스', 'Шоукейс молодых комиков', 'Yosh komiklar shoukeysi'),
		t('A showcase of up-and-coming comedians on one stage.',
			'떠오르는 신인 코미디언들의 무대를 한자리에서 만나는 쇼케이스입니다.',
			'Шоукейс начинающих комиков на одной сцене.',
			"Yangi komiklarning chiqishlari bir sahnada.")),
	base('improv', COMEDY,
		t('Improv Battle Night', '즉흥 코미디 배틀 나이트', 'Ночь импровизации', 'Improv jangi kechasi'),
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
		t('Vinyl & Craft Market', '바이닐 & 크래프트 마켓', 'Ярмарка винила и ремёсел', 'Vinil va hunarmandchilik bozori'),
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
		t('Indie Game Expo', '인디 게임 엑스포', 'Выставка инди-игр', "Indi o'yinlar ko'rgazmasi"),
		t('Forty small studios show games you can play on the spot, with talks by the developers.',
			'40개의 소규모 스튜디오가 현장에서 바로 즐길 수 있는 게임을 선보이며 개발자 토크도 진행됩니다.',
			'Сорок небольших студий показывают игры, в которые можно сыграть на месте, и проводят доклады.',
			"Qirqta kichik studiya joyida o'ynash mumkin bo'lgan o'yinlarni ko'rsatadi, dasturchilar suhbatlari bilan.")),
];

/** COMMENTS written by buyers (one per language); the organizer answers with a @nick prefix because comments have no replies */

export const DEMO_COMMENTS: Localized[] = [
	t('Booked my tickets already, cannot wait!', '벌써 예매했어요! 너무 기대돼요.', 'Уже купил билеты, очень жду!', 'Chiptalarni oldim, juda kutyapman!'),
	t('Can a group of six sit together?', '6명이 함께 앉을 수 있을까요?', 'Можно ли сесть рядом компанией из шести человек?', "Olti kishilik guruh yonma-yon o'tira oladimi?"),
	t('Great line-up for the price.', '가격 대비 구성이 정말 좋네요.', 'За такую цену программа отличная.', 'Narxiga nisbatan dastur ajoyib.'),
	t('I went last time and the sound was fantastic.', '지난번에도 갔는데 음향이 최고였어요.', 'В прошлый раз звук был великолепный.', "O'tgan safar tovush juda yaxshi edi."),
	t('What time do the doors open?', '입장은 몇 시부터인가요?', 'Во сколько открываются двери?', 'Eshiklar soat nechada ochiladi?'),
	t('Is the venue easy to reach by subway?', '지하철로 가기 편한 곳인가요?', 'Удобно ли добираться до зала на метро?', "Zalga metro bilan borish qulaymi?"),
];
export const DEMO_REPLIES: Localized = t(
	'Thank you for asking! Seats in one row are sold side by side, and doors open one hour before the start.',
	'문의 감사합니다! 같은 열 좌석은 나란히 판매되며, 입장은 시작 1시간 전부터입니다.',
	'Спасибо за вопрос! Места в одном ряду продаются рядом, двери открываются за час до начала.',
	"Savol uchun rahmat! Bir qatordagi o'rindiqlar yonma-yon sotiladi, eshiklar boshlanishidan bir soat oldin ochiladi.",
);

/** names of records that the seed is not allowed to delete but the check reports as probable QA data (never touched) */
export const QA_NAME_PATTERNS: RegExp[] = [/^zz[\s_-]/i, /clash\s*test/i, /\bqa[\s_-]?(test|data)\b/i, /^test[\s_-]/i];
