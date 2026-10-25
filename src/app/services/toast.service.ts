import { Injectable, signal } from '@angular/core';

/** Short messages at the bottom of the screen ("Saved to Liked ♥"). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal('');
  readonly visible = signal(false);
  private timer?: ReturnType<typeof setTimeout>;

  show(message: string, durationMs = 2200): void {
    this.message.set(message);
    this.visible.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.visible.set(false), durationMs);
  }
}
