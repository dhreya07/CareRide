import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/services/auth.service';
import { ResetPasswordPage } from './reset-password.page';

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('explains an expired link and can request another', async () => {
    const sendPasswordReset = vi.fn().mockResolvedValue(undefined);
    const updateRecoveredPassword = vi.fn();
    const fixture = await createPage({
      openPasswordRecovery: vi.fn().mockResolvedValue('expired'),
      sendPasswordReset,
      updateRecoveredPassword,
    });

    expect(fixture.componentInstance.mode).toBe('expired');
    expect(fixture.nativeElement.textContent).toContain(
      'This recovery link is invalid or has expired. Request a new link.',
    );
    expect(fixture.nativeElement.textContent).toContain('Request a new link');

    fixture.componentInstance.email = 'admin@example.com';
    await fixture.componentInstance.requestLink();
    fixture.detectChanges();

    expect(sendPasswordReset).toHaveBeenCalledWith('admin@example.com');
    expect(updateRecoveredPassword).not.toHaveBeenCalled();
  });

  it('updates the password only after the recovery session is ready', async () => {
    const updateRecoveredPassword = vi.fn().mockResolvedValue(undefined);
    const fixture = await createPage({
      openPasswordRecovery: vi.fn().mockResolvedValue('ready'),
      sendPasswordReset: vi.fn(),
      updateRecoveredPassword,
    });

    fixture.componentInstance.password = 'next-password';
    fixture.componentInstance.confirmPassword = 'next-password';
    await fixture.componentInstance.savePassword();
    fixture.detectChanges();

    expect(updateRecoveredPassword).toHaveBeenCalledWith('next-password');
    expect(fixture.nativeElement.textContent).toContain('Your password was updated.');
  });
});

async function createPage(auth: {
  openPasswordRecovery: ReturnType<typeof vi.fn>;
  sendPasswordReset: ReturnType<typeof vi.fn>;
  updateRecoveredPassword: ReturnType<typeof vi.fn>;
}) {
  await TestBed.configureTestingModule({
    imports: [ResetPasswordPage],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ResetPasswordPage);
  fixture.detectChanges();
  await fixture.componentInstance.linkCheck;
  fixture.detectChanges();
  return fixture;
}
