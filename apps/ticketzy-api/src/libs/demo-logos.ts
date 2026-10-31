/**
 * Organizer logos for the demo data (DECISIONS #131): simple SVG monograms, generated here and committed in
 * `demo-images/logos/`. Nothing is downloaded and no brand is imitated: a rounded square, a color and one or two Latin initials
 * taken from the organizer's nick. The stored value is the relative path `demo-images/logos/<key>.svg`, the form the frontend
 * already turns into the API address.
 */
import type { OrganizerKey } from './demo-data';

export const DEMO_LOGO_DIR = 'demo-images/logos';

export interface DemoLogo {
	initials: string;
	background: string;
	foreground: string;
}

export const DEMO_LOGOS: Record<OrganizerKey, DemoLogo> = {
	hanbit: { initials: 'HL', background: '#1d4ed8', foreground: '#ffffff' },
	mirae: { initials: 'MS', background: '#7c3aed', foreground: '#ffffff' },
	harbor: { initials: 'HS', background: '#0e7490', foreground: '#ffffff' },
	cellar: { initials: 'LC', background: '#b45309', foreground: '#ffffff' },
	camellia: { initials: 'CA', background: '#be123c', foreground: '#ffffff' },
	nomad: { initials: 'SC', background: '#15803d', foreground: '#ffffff' },
	neon: { initials: 'NA', background: '#111827', foreground: '#22d3ee' },
	jeju: { initials: 'TF', background: '#ea580c', foreground: '#ffffff' },
	pending: { initials: 'NS', background: '#475569', foreground: '#ffffff' },
	rejected: { initials: 'GT', background: '#64748b', foreground: '#ffffff' },
};

export const demoLogoPath = (key: OrganizerKey): string => `${DEMO_LOGO_DIR}/${key}.svg`;

/** a 256 x 256 monogram; the text uses a generic sans-serif stack, so no font file is needed */
export const buildLogoSvg = (logo: DemoLogo): string =>
	[
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="' + logo.initials + '">',
		`<rect width="256" height="256" rx="56" fill="${logo.background}"/>`,
		`<text x="128" y="128" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-size="108" font-weight="700" letter-spacing="2" fill="${logo.foreground}">${logo.initials}</text>`,
		'</svg>',
		'',
	].join('\n');
