import next from 'eslint-config-next';

const config = [
	{ ignores: ['.next/**', 'node_modules/**', 'test-data/**', 'data/**', 'scripts/**'] },
	...next
];

export default config;
