/**
 * Entry point KeClima.
 * @module main
 */

import { createApp } from './app.js';

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) {
    return;
  }
  splash.classList.add('splash-hide');
  setTimeout(() => splash.remove(), 400);
}

async function boot() {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('#app não encontrado');
  }

  // Segurança: nunca deixar a splash travar a UI
  const splashFailsafe = setTimeout(() => {
    console.warn('[KeClima] splash failsafe — forçando remoção');
    hideSplash();
  }, 2500);

  try {
    await createApp(root, { onReady: hideSplash });
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="boot-error"><p>Falha ao iniciar KeClima.</p><pre>${String(err?.message || err)}</pre></div>`;
    hideSplash();
  } finally {
    clearTimeout(splashFailsafe);
    hideSplash();
  }

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
    } catch (err) {
      console.warn('[KeClima] SW não registrado:', err);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
