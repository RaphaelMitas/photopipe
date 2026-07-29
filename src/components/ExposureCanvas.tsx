'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExposureRenderer, type AdjustmentParams } from '@/lib/webgl/exposure-renderer';

interface ExposureCanvasProps {
	src: string;
	alt: string;
	adjustments: AdjustmentParams;
	className?: string;
}

export function ExposureCanvas({ src, alt, adjustments, className }: ExposureCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const rendererRef = useRef<ExposureRenderer | null>(null);
	const adjustmentsRef = useRef(adjustments);
	const [fallback, setFallback] = useState(false);
	const [loadedSrc, setLoadedSrc] = useState('');

	useEffect(() => {
		adjustmentsRef.current = adjustments;
	}, [adjustments]);

	// A callback ref rather than an effect: the renderer must exist before the
	// image-loading effect below runs, and failing over to <img> is a decision
	// made at attach time, not a synchronisation step.
	const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
		canvasRef.current = canvas;

		if (!canvas) {
			rendererRef.current?.destroy();
			rendererRef.current = null;
			return;
		}

		try {
			rendererRef.current = new ExposureRenderer(canvas);
		} catch {
			setFallback(true);
		}
	}, []);

	useEffect(() => {
		const renderer = rendererRef.current;
		if (!renderer || !src) return;

		let stale = false;
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.onload = () => {
			if (stale) return;
			renderer.loadImage(image);
			renderer.render(adjustmentsRef.current);
			setLoadedSrc(src);
		};
		image.src = src;

		return () => {
			stale = true;
		};
	}, [src]);

	useEffect(() => {
		const renderer = rendererRef.current;
		if (!renderer || !loadedSrc) return;
		renderer.render(adjustments);
	}, [adjustments, loadedSrc]);

	if (fallback) {
		// eslint-disable-next-line @next/next/no-img-element
		return <img src={src} alt={alt} className={className} draggable={false} />;
	}

	return <canvas ref={attachCanvas} className={className} draggable={false} aria-label={alt} />;
}
