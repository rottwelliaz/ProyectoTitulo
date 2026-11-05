import type { SweetAlertOptions } from 'sweetalert2';

const appearance = {
  customClass: { container: 'cbc-notifications', popup: 'cbc-notification' },
  buttonsStyling: false,
  confirmButtonText: 'Entendido',
  cancelButtonText: 'Cancelar',
  closeButtonAriaLabel: 'Cerrar notificación',
  heightAuto: false,
  returnFocus: true,
} satisfies SweetAlertOptions;

let modalOpen = false;
let modalClosed = Promise.resolve();

// Browser code is loaded only when called by an Astro event handler or a React island.
const loadSwal = async () => (await import('sweetalert2')).default;
const target = () => document.querySelector<HTMLDialogElement>('dialog[open]') || document.body;

async function showModal(options: SweetAlertOptions, skipIfBusy = false): Promise<boolean> {
  if (typeof window === 'undefined' || (skipIfBusy && modalOpen)) return false;
  while (modalOpen) await modalClosed;
  const previousFocus = document.activeElement;
  modalOpen = true;
  let release!: () => void;
  modalClosed = new Promise<void>(resolve => { release = resolve; });
  try {
    const Swal = await loadSwal();
    const result = await Swal.fire({
      ...appearance, target: target(),
      didClose: () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); },
      ...options,
    });
    return result.isConfirmed === true;
  } finally {
    modalOpen = false;
    release();
  }
}

export function confirmAction(text: string, confirmButtonText = 'Sí, continuar', destructive = true, labels?: { titleText?: string; cancelButtonText?: string }) {
  return showModal({
    titleText: 'Confirmar acción', text, icon: 'warning',
    showCancelButton: true, showCloseButton: true,
    confirmButtonText, focusCancel: true,
    customClass: { ...appearance.customClass, confirmButton: destructive ? 'cbc-danger' : '' },
    ...labels,
  }, true);
}

export async function notifySuccess(text: string): Promise<void> {
  if (typeof window === 'undefined' || !text) return;
  const Swal = await loadSwal();
  // A completed operation must never replace a confirmation awaiting a decision.
  while (modalOpen) await modalClosed;
  await Swal.fire({
    ...appearance, target: target(), toast: true, position: 'top-end',
    titleText: text, icon: 'success', showConfirmButton: false,
    showCloseButton: true, timer: 4500, timerProgressBar: true,
    didOpen: popup => {
      popup.addEventListener('mouseenter', () => Swal.stopTimer());
      popup.addEventListener('mouseleave', () => Swal.resumeTimer());
      popup.addEventListener('focusin', () => Swal.stopTimer());
      popup.addEventListener('focusout', () => Swal.resumeTimer());
    },
  });
}

// Callers pass user-facing text, never raw exceptions or server diagnostics.
export const notifyError = (text = 'No se pudo completar la operación. Inténtalo nuevamente.') =>
  showModal({ titleText: 'No se pudo completar', text, icon: 'error' });

export const notifyWarning = (text: string, titleText = 'Revisa esta información', skipIfBusy = false) =>
  showModal({ titleText, text, icon: 'warning' }, skipIfBusy);
