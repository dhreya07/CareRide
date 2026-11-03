import { environment } from '../../../environments/environment';
import { AdminAuthProbeReport, probeApprovedAdmin } from './admin-auth-probe';

const DIALOG_ID = 'care-ride-admin-auth-test';
const RESULT_ID = 'care-ride-admin-auth-test-result';

/** Registers the console opener. It does not show the dialog or sign in. */
export function installAdminAuthTestDialog(): void {
  if (environment.production || typeof globalThis === 'undefined') {
    return;
  }
  Object.defineProperty(globalThis, 'openCareRideAdminTest', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: openCareRideAdminTest,
  });
}

/** Opens the temporary admin test dialog. Credentials stay in the input fields only. */
export function openCareRideAdminTest(): void {
  if (environment.production || typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(DIALOG_ID)) {
    return;
  }

  const email = input('email', 'Admin email', 'care-ride-admin-test-email');
  const password = input('password', 'Password', 'care-ride-admin-test-password');
  const testButton = button('Test Connection');
  const cancelButton = button('Cancel');
  const root = overlay(DIALOG_ID, 'Development admin authentication test');
  const card = panel();
  const title = heading('Development admin authentication test');
  card.append(title, email.label, email.field, password.label, password.field, testButton, cancelButton);
  root.append(card);
  document.body.append(root);

  cancelButton.addEventListener('click', () => {
    clearInputs(email.field, password.field);
    root.remove();
  });

  testButton.addEventListener('click', () => {
    void runTest(email.field, password.field, testButton, cancelButton, root);
  });
}

async function runTest(
  email: HTMLInputElement,
  password: HTMLInputElement,
  testButton: HTMLButtonElement,
  cancelButton: HTMLButtonElement,
  root: HTMLElement,
): Promise<void> {
  testButton.disabled = true;
  cancelButton.disabled = true;
  const emailValue = email.value;
  const passwordValue = password.value;
  let result: AdminAuthProbeReport;
  try {
    result = await probeApprovedAdmin(emailValue, passwordValue);
  } catch {
    result = {
      authorized: false,
      role: null,
      accountStatus: null,
      signedOut: true,
      message: 'Unexpected authentication error. The test session was signed out.',
    };
  }
  clearInputs(email, password);
  root.remove();
  showResult(result);
}

function showResult(result: AdminAuthProbeReport): void {
  document.getElementById(RESULT_ID)?.remove();
  const root = overlay(RESULT_ID, 'Admin authentication test result');
  const card = panel();
  const title = heading('Admin authentication test result');
  card.append(
    title,
    line('authorized', String(result.authorized)),
    line('role', result.role ?? 'null'),
    line('accountStatus', result.accountStatus ?? 'null'),
    line('signedOut', String(result.signedOut)),
    line('message', result.message),
  );
  const close = button('Close');
  close.addEventListener('click', () => root.remove());
  card.append(close);
  root.append(card);
  document.body.append(root);
}

function clearInputs(email: HTMLInputElement, password: HTMLInputElement): void {
  email.value = '';
  password.value = '';
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

function input(type: 'email' | 'password', labelText: string, id: string): {
  label: HTMLLabelElement;
  field: HTMLInputElement;
} {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const field = document.createElement('input');
  field.id = id;
  field.type = type;
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

function line(name: string, value: string): HTMLElement {
  const row = document.createElement('p');
  row.style.margin = '0';
  const nameNode = document.createElement('strong');
  nameNode.textContent = `${name}: `;
  row.append(nameNode, document.createTextNode(value));
  return row;
}

declare global {
  interface Window {
    openCareRideAdminTest?: typeof openCareRideAdminTest;
  }
}
