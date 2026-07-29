import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	// Not using `output: 'standalone'`: file tracing cannot see the vendored
	// exiftool Perl script, so the runtime image ships real node_modules.
	serverExternalPackages: ['better-sqlite3', 'exiftool-vendored', 'sharp', 'chokidar', 'archiver'],
	experimental: {
		// Uploads stream to disk; keep the body size cap out of the way.
		proxyTimeout: 1000 * 60 * 30
	}
};

export default nextConfig;
