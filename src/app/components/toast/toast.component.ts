import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ToastService } from '../../services/toast.service';

/** Shows ToastService messages at the bottom of the screen. */
@Component({
  selector: 'app-toast',
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastComponent {
  protected readonly toast = inject(ToastService);
}
