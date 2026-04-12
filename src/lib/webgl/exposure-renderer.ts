import { VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE } from './shaders.js';

export interface AdjustmentParams {
	exposure: number;
	highlights: number;
	shadows: number;
	contrast: number;
}

export const DEFAULT_ADJUSTMENTS: AdjustmentParams = {
	exposure: 0,
	highlights: 0,
	shadows: 0,
	contrast: 0
};

export function hasAdjustments(p: AdjustmentParams): boolean {
	return p.exposure !== 0 || p.highlights !== 0 || p.shadows !== 0 || p.contrast !== 0;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Failed to create shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile error: ${info}`);
	}
	return shader;
}

function linkProgram(
	gl: WebGL2RenderingContext,
	vert: WebGLShader,
	frag: WebGLShader
): WebGLProgram {
	const program = gl.createProgram();
	if (!program) throw new Error('Failed to create program');
	gl.attachShader(program, vert);
	gl.attachShader(program, frag);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Program link error: ${info}`);
	}
	return program;
}

export class ExposureRenderer {
	private gl: WebGL2RenderingContext;
	private program: WebGLProgram;
	private vertShader: WebGLShader;
	private fragShader: WebGLShader;
	private texture: WebGLTexture;
	private vao: WebGLVertexArrayObject;
	private uniforms: {
		exposure: WebGLUniformLocation;
		highlights: WebGLUniformLocation;
		shadows: WebGLUniformLocation;
		contrast: WebGLUniformLocation;
	};
	private hasImage = false;

	constructor(canvas: HTMLCanvasElement) {
		const gl = canvas.getContext('webgl2', {
			alpha: false,
			desynchronized: true,
			premultipliedAlpha: false
		});
		if (!gl) throw new Error('WebGL2 not available');
		this.gl = gl;

		this.vertShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
		this.fragShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
		this.program = linkProgram(gl, this.vertShader, this.fragShader);

		const vao = gl.createVertexArray();
		if (!vao) throw new Error('Failed to create VAO');
		this.vao = vao;

		const texture = gl.createTexture();
		if (!texture) throw new Error('Failed to create texture');
		this.texture = texture;

		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

		gl.useProgram(this.program);
		const loc = (name: string) => {
			const l = gl.getUniformLocation(this.program, name);
			if (!l) throw new Error(`Uniform ${name} not found`);
			return l;
		};
		this.uniforms = {
			exposure: loc('u_exposure'),
			highlights: loc('u_highlights'),
			shadows: loc('u_shadows'),
			contrast: loc('u_contrast')
		};
	}

	loadImage(image: HTMLImageElement): void {
		const { gl } = this;
		const canvas = gl.canvas as HTMLCanvasElement;
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		gl.viewport(0, 0, canvas.width, canvas.height);

		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		this.hasImage = true;
	}

	render(params: AdjustmentParams): void {
		if (!this.hasImage) return;
		const { gl } = this;

		gl.useProgram(this.program);
		gl.bindVertexArray(this.vao);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);

		gl.uniform1f(this.uniforms.exposure, params.exposure);
		gl.uniform1f(this.uniforms.highlights, params.highlights);
		gl.uniform1f(this.uniforms.shadows, params.shadows);
		gl.uniform1f(this.uniforms.contrast, params.contrast);

		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	destroy(): void {
		const { gl } = this;
		gl.deleteTexture(this.texture);
		gl.deleteVertexArray(this.vao);
		gl.deleteProgram(this.program);
		gl.deleteShader(this.vertShader);
		gl.deleteShader(this.fragShader);
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}
