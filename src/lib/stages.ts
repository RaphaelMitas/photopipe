import type { PhysicalStage, ViewStage } from './types';

/** Client-side mirror of the server's per-stage extension allowlist. */
export const STAGE_ACCEPT: Record<PhysicalStage, string[]> = {
	raw: ['.arw'],
	denoised: ['.dng'],
	exports: ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.dng']
};

/** Which physical files a view is drawn from. */
export const VIEW_SOURCE_STAGE: Record<ViewStage, PhysicalStage> = {
	raw: 'raw',
	denoised: 'denoised',
	rated: 'denoised',
	selects: 'denoised',
	exports: 'exports'
};

export const VIEW_LABELS: Record<ViewStage, string> = {
	raw: 'Raw',
	denoised: 'Denoised',
	rated: 'Rate',
	selects: 'Selects',
	exports: 'Export'
};

export const VIEW_ORDER: ViewStage[] = ['raw', 'denoised', 'rated', 'selects', 'exports'];
