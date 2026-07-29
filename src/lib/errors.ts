export type ErrorCode = 'NOT_FOUND' | 'INVALID_INPUT' | 'FS_ERROR' | 'CONFLICT';

const STATUS: Record<ErrorCode, number> = {
	NOT_FOUND: 404,
	INVALID_INPUT: 400,
	FS_ERROR: 500,
	CONFLICT: 409
};

export class PhotopipeError extends Error {
	readonly code: ErrorCode;
	readonly status: number;

	constructor(message: string, code: ErrorCode) {
		super(message);
		this.name = 'PhotopipeError';
		this.code = code;
		this.status = STATUS[code];
	}
}

/** Wraps a route handler so PhotopipeError maps to its status and anything else is a 500. */
export async function handleRoute(fn: () => Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof PhotopipeError) {
			return Response.json({ error: err.message, code: err.code }, { status: err.status });
		}
		console.error('Unhandled route error:', err);
		const message = err instanceof Error ? err.message : 'Internal error';
		return Response.json({ error: message, code: 'FS_ERROR' }, { status: 500 });
	}
}
