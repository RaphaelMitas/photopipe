import type { PhysicalStage } from './config';

export type { PhysicalStage };

/** Stages the UI can ask for: physical directories plus query-backed views. */
export type ViewStage = PhysicalStage | 'rated' | 'selects';

export type DenoiseAlgorithm = 'DeepPRIME 3' | 'DeepPRIME XD3';

export type StarRating = 1 | 2 | 3 | 4 | 5;

/** XMP label marking a curated pick. Standard field, readable by Lightroom/Bridge. */
export const SELECT_LABEL = 'Select';

export type ShootStatus =
	'empty' | 'uploading' | 'denoising' | 'ready' | 'rating' | 'curating' | 'exported';

/** Seconds per file for each algorithm on an M4 Mac Mini. */
export const DENOISE_TIMES: Record<DenoiseAlgorithm, number> = {
	'DeepPRIME 3': 24,
	'DeepPRIME XD3': 54
};

export const PURERAW_SETTINGS = {
	outputFormat: 'Hi-Fi Compressed DNG',
	lensSharpness: 'High',
	opticalCorrections: 'All ON',
	dustRemoval: 'ON'
} as const;

/** Shoot-level metadata, persisted to .photopipe.json inside the shoot folder. */
export interface ShootManifest {
	version: 2;
	name: string;
	date: string;
	createdAt: string;
	algorithm: DenoiseAlgorithm | null;
	notes: string;
	rawCount: number | null;
}

export interface FileInfo {
	name: string;
	stage: PhysicalStage;
	sizeBytes: number;
	modifiedAt: string;
	rating: StarRating | null;
	isSelect: boolean;
}

export interface StageCounts {
	raw: number;
	denoised: number;
	rated: number;
	selects: number;
	exports: number;
}

export interface StageSizes {
	raw: number;
	denoised: number;
	rated: number;
	selects: number;
	exports: number;
}

export interface ShootSummary {
	folderName: string;
	name: string;
	date: string;
	counts: StageCounts;
	sizes: StageSizes;
	totalSizeBytes: number;
	status: ShootStatus;
}

export interface ShootDetail extends ShootSummary {
	manifest: ShootManifest;
	files: FileInfo[];
}

export interface PureRawInstructions {
	inputPath: string;
	outputPath: string;
	settings: typeof PURERAW_SETTINGS;
}

/** Payload of the single SSE invalidation channel. No data rides this stream. */
export interface InvalidationEvent {
	folderName: string | null;
	stages: PhysicalStage[];
	at: string;
}
