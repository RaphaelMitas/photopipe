export type DenoiseAlgorithm = 'DeepPRIME 3' | 'DeepPRIME XD3';

export type ShootStatus =
	| 'empty'
	| 'uploading'
	| 'denoising'
	| 'ready'
	| 'rating'
	| 'curating'
	| 'exported';

export type StarRating = 1 | 2 | 3 | 4 | 5;

/** Seconds per file for each algorithm on M4 Mac Mini */
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

export interface ShootMetadata {
	version: number;
	name: string;
	date: string;
	createdAt: string;
	algorithm: DenoiseAlgorithm | null;
	notes: string;
	rawCount: number | null;
	ratings: Record<string, StarRating>;
}

export interface ShootSummary {
	/** Folder name, e.g. "2026-04-10 Spring Concert" */
	folderName: string;
	name: string;
	date: string;
	rawCount: number;
	dngCount: number;
	ratedCount: number;
	selectCount: number;
	exportCount: number;
	totalSizeBytes: number;
	status: ShootStatus;
}

export interface ShootDetail extends ShootSummary {
	metadata: ShootMetadata;
	rawFiles: FileInfo[];
	dngFiles: FileInfo[];
	ratedFiles: RatedFileInfo[];
	selectFiles: FileInfo[];
	exportFiles: FileInfo[];
	rawSizeBytes: number;
	dngSizeBytes: number;
	ratedSizeBytes: number;
	selectSizeBytes: number;
	exportSizeBytes: number;
}

export interface FileInfo {
	name: string;
	sizeBytes: number;
	modifiedAt: string;
}

export interface RatedFileInfo extends FileInfo {
	rating: StarRating;
}

export interface DenoiseEvent {
	type: 'file' | 'idle';
	dngCount: number;
	latestFile: string | null;
	idleMinutes?: number;
	timestamp: string;
}

export interface PureRawInstructions {
	inputPath: string;
	outputPath: string;
	settings: typeof PURERAW_SETTINGS;
}
