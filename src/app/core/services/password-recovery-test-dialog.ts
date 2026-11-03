import { environment } from '../../../environments/environment';
import { requestPasswordRecovery } from './password-recovery';

const DIALOG_ID = 'care-ride-password-recovery-test';
const RESULT_ID = 'care-ride-password-recovery-test-result';
const EMAIL_ID = 'care-ride-recovery-test-email';
const LOCAL_RECOVERY_ORIGIN = 'http://localhost:8100';

/** Registers the console opener. It does not show the dialog or send email. */
export function installPasswordRecoveryTestDialog(): void {
  if (environment.production || typeof globalThis === 'undefined') {
    return;
  }
  const hosts = new Set<object>([globalThis]);
  if (typeof window !== 'undefined') {
    hosts.add(window);
  }
  for (const host of hosts) {
    Object.defineProperty(host, 'openCareRidePasswordRecovery', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: openCareRidePasswordRecovery,
    });
  }
}

/** Opens the recovery request dialog. Nothing is sent until the button is pressed. */
export function openCareRidePasswordRecovery(): void {
  if (environment.production || typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(DIALOG_ID)) {
    return;
  }

  const email = input('Admin email', EMAIL_ID);
  const sendButton = button('Send Recovery Email');
  const cancelButton = button('Cancel');
  const root = overlay(DIALOG_ID, 'Development password recovery test');
  const card = panel();
  const title = heading('Development password recovery test');
  card.append(title, email.label, email.field, sendButton, cancelButton);
  root.append(card);
  document.body.append(root);

  cancelButton.addEventListener('click', () => {
    email.field.value = '';
    root.remove();
  });

  sendButton.addEventListener('click', () => {
    void sendRecovery(email.field, sendButton, cancelButton, root);
  });
}

async function sendRecovery(
  email: HTMLInputElement,
  sendButton: HTMLButtonElement,
  cancelButton: HTMLButtonElement,
  root: HTMLElement,
): Promise<void> {
  const emailValue = email.value.trim();
  if (!emailValue) {
    showResult('Enter the admin email address first.');
    return;
  }
  sendButton.disabled = true;
  cancelButton.disabled = true;
  let message = 'Recovery email requested. Open the newest link on the reset page.';
  try {
    await requestPasswordRecovery(emailValue, LOCAL_RECOVERY_ORIGIN);
  } catch (error: unknown) {
    message = safeNotice(error);
  }
  email.value = '';
  root.remove();
  showResult(message);
}

function safeNotice(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message || /eyJ|bearer|sb_secret|sb_publishable|access_token|refresh_token|@/i.test(message)) {
    return 'Unable to send a password reset message.';
  }
  return message;
}

function showResult(message: string): void {
  document.getElementById(RESULT_ID)?.remove();
  const root = overlay(RESULT_ID, 'Password recovery test result');
  const card = panel();
  const title = heading('Password recovery test result');
  const body = document.createElement('p');
  body.textContent = message;
  body.style.margin = '0';
  const close = button('Close');
  close.addEventListener('click', () => root.remove());
  card.append(title, body, close);
  root.append(card);
  document.body.append(root);
}

function overlay(id: string, label: string): HTMLElement {
  const root = document.createElement('div');
  root.id = id;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', label);
  root.style.position = 'fixed';
  root.style.inset = '0';
  root.style.zIndex = '10000';
  root.style.display = 'grid';
  root.style.placeItems = 'center';
  root.style.background = 'rgba(15, 23, 42, 0.55)';
  root.style.padding = '24px';
  return root;
}

function panel(): HTMLElement {
  const card = document.createElement('div');
  card.style.width = 'min(420px, 100%)';
  card.style.display = 'grid';
  card.style.gap = '12px';
  card.style.padding = '20px';
  card.style.borderRadius = '12px';
  card.style.background = '#ffffff';
  card.style.color = '#0f172a';
  return card;
}

function heading(text: string): HTMLElement {
  const title = document.createElement('h2');
  title.textContent = text;
  title.style.margin = '0';
  title.style.fontSize = '18px';
  return title;
}

function input(labelText: string, id: string): { label: HTMLLabelElement; field: HTMLInputElement } {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const field = document.createElement('input');
  field.id = id;
  field.type = 'email';
  field.autocomplete = 'off';
  field.spellcheck = false;
  field.style.width = '100%';
  field.style.boxSizing = 'border-box';
  field.style.padding = '10px';
  return { label, field };
}

function button(text: string): HTMLButtonElement {
  const control = document.createElement('button');
  control.type = 'button';
  control.textContent = text;
  control.style.padding = '10px 12px';
  return control;
}

declare global {
  interface Window {
    openCareRidePasswordRecovery?: typeof openCareRidePasswordRecovery;
  }
}
