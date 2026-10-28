import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal } from '@angular/core';

import { AccountService, friendlyAuthError } from '../../services/account.service';
import { ToastService } from '../../services/toast.service';

type View = 'welcome' | 'signup' | 'login' | 'forgot' | 'phone' | 'otp';

/** Country codes offered for phone sign-in (India first). */
const COUNTRIES = [
  { code: '+91', name: 'India' }, { code: '+971', name: 'UAE' }, { code: '+1', name: 'USA / Canada' },
  { code: '+44', name: 'UK' }, { code: '+65', name: 'Singapore' }, { code: '+61', name: 'Australia' },
  { code: '+977', name: 'Nepal' }, { code: '+966', name: 'Saudi Arabia' }, { code: '+974', name: 'Qatar' },
  { code: '+60', name: 'Malaysia' }, { code: '+49', name: 'Germany' },
];

/**
 * Welcome / sign up / log in, full screen — like the big music apps.
 * Email + password, phone + OTP, or Google.
 */
@Component({
  selector: 'app-account-screen',
  templateUrl: './account-screen.component.html',
  styleUrl: './account-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountScreenComponent {
  protected readonly account = inject(AccountService);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly countries = COUNTRIES;
  protected readonly view = signal<View>('welcome');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly info = signal('');
  protected readonly showPassword = signal(false);

  // form fields
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly country = signal('+91');
  protected readonly phone = signal('');
  protected readonly otp = signal('');

  /** Seconds until "Resend OTP" works again. */
  protected readonly resendIn = signal(0);
  private resendTimer?: ReturnType<typeof setInterval>;

  protected readonly fullPhone = computed(() => `${this.country()}${this.phone().replace(/\D/g, '').replace(/^0+/, '')}`);
  protected readonly canSignUp = computed(() => /\S+@\S+\.\S+/.test(this.email()) && this.password().length >= 6);
  protected readonly canLogIn = computed(() => /\S+@\S+\.\S+/.test(this.email()) && this.password().length > 0);
  protected readonly canSendOtp = computed(() => this.phone().replace(/\D/g, '').length >= 6);

  constructor() {
    // Each time the screen opens, start from the welcome view.
    effect(() => {
      if (this.account.screenOpen()) { this.go('welcome'); this.password.set(''); this.otp.set(''); }
    });
  }

  protected go(view: View): void {
    this.view.set(view);
    this.error.set('');
    this.info.set('');
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.view input')?.focus(), 80);
  }

  protected back(): void {
    const v = this.view();
    this.go(v === 'otp' ? 'phone' : v === 'forgot' ? 'login' : 'welcome');
  }

  protected async signUp(): Promise<void> {
    if (!this.canSignUp()) { this.error.set('Enter your email and a password of at least 6 characters.'); return; }
    await this.run(() => this.account.signUpWithEmail(this.name(), this.email(), this.password()));
  }

  protected async logIn(): Promise<void> {
    if (!this.canLogIn()) { this.error.set('Enter your email and password.'); return; }
    await this.run(() => this.account.logInWithEmail(this.email(), this.password()));
  }

  protected async forgot(): Promise<void> {
    if (!/\S+@\S+\.\S+/.test(this.email())) { this.error.set('Enter the email you signed up with.'); return; }
    const ok = await this.run(() => this.account.resetPassword(this.email()));
    if (ok) this.info.set(this.account.demo
      ? 'Demo accounts live on this device, so no email is sent. If you forgot the password, sign up again with another email, or delete the account in Settings.'
      : `We've sent a link to ${this.email().trim()}. Open it to choose a new password, then log in.`);
  }

  protected async google(): Promise<void> {
    await this.run(() => this.account.continueWithGoogle());
  }

  protected async sendOtp(resend = false): Promise<void> {
    if (!this.canSendOtp()) { this.error.set('Enter your mobile number.'); return; }
    const ok = await this.run(() => this.account.sendOtp(this.fullPhone(), resend));
    if (!ok) return;
    if (!this.account.signedIn()) {
      if (!resend) this.go('otp');
      else this.toast.show('OTP sent again');
      this.startResendTimer();
    }
  }

  protected async confirmOtp(): Promise<void> {
    if (this.otp().replace(/\D/g, '').length < 6) { this.error.set('Enter the 6-digit code.'); return; }
    await this.run(() => this.account.confirmOtp(this.otp().replace(/\D/g, '')));
  }

  protected onOtpInput(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    this.otp.set(digits);
    if (digits.length === 6 && !this.busy()) this.confirmOtp();
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Runs a sign-in step with a spinner and friendly errors. Returns true if it worked. */
  private async run(step: () => Promise<void>): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      await step();
      return true;
    } catch (err) {
      this.error.set(friendlyAuthError(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private startResendTimer(): void {
    clearInterval(this.resendTimer);
    this.resendIn.set(30);
    this.resendTimer = setInterval(() => {
      this.resendIn.update(s => s - 1);
      if (this.resendIn() <= 0) clearInterval(this.resendTimer);
    }, 1000);
  }
}
