import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'play' | 'pause' | 'next' | 'previous' | 'shuffle' | 'heart' | 'heart-filled'
  | 'volume' | 'search' | 'menu' | 'close' | 'globe' | 'chevron-down' | 'check'
  | 'mic' | 'download' | 'downloaded' | 'trash' | 'settings' | 'moon' | 'offline' | 'android';

/** All app icons in one place. Usage: <app-icon name="play" /> */
@Component({
  selector: 'app-icon',
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
