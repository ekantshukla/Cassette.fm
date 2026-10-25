import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, viewChild } from '@angular/core';

interface Orb { x: number; y: number; r: number; color: string; alpha: number; vx: number; vy: number; twinkle: number; }

const COLORS = ['255,111,145', '255,194,209', '255,215,163', '180,120,255', '255,150,120'];

/** Dusk sky with soft glowing lights drifting upward, behind everything. */
@Component({
  selector: 'app-bokeh-background',
  templateUrl: './bokeh-background.component.html',
  styleUrl: './bokeh-background.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BokehBackgroundComponent {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => this.start());
  }

  private start(): void {
    const canvas = this.canvas().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0, height = 0, orbs: Orb[] = [], frame = 0;

    const resize = () => {
      const ratio = Math.min(devicePixelRatio || 1, 2);
      width = innerWidth;
      height = innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.round(Math.min(34, (width * height) / 38000) + 10);
      orbs = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 6 + Math.random() * Math.random() * 70,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: 0.05 + Math.random() * 0.22,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -0.05 - Math.random() * 0.18,
        twinkle: Math.random() * 6.28,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      for (const o of orbs) {
        if (!still) {
          o.x += o.vx; o.y += o.vy; o.twinkle += 0.01;
          if (o.y < -80) { o.y = height + 80; o.x = Math.random() * width; }
          if (o.x < -80) o.x = width + 80;
          if (o.x > width + 80) o.x = -80;
        }
        const a = o.alpha * (0.75 + 0.25 * Math.sin(o.twinkle));
        const glow = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        glow.addColorStop(0, `rgba(${o.color},${a})`);
        glow.addColorStop(0.6, `rgba(${o.color},${a * 0.45})`);
        glow.addColorStop(1, `rgba(${o.color},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (!still) frame = requestAnimationFrame(draw);
    };

    const onResize = () => { resize(); if (still) draw(); };
    resize();
    draw();
    addEventListener('resize', onResize);
    this.destroyRef.onDestroy(() => { cancelAnimationFrame(frame); removeEventListener('resize', onResize); });
  }
}
