// Al pulsar el icono de la extensión se abre el panel lateral.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// TODO(Etapa 0): bandeja de avisos propia de la extensión. No se reutiliza el service worker
// de la PWA; la recepción en segundo plano se diseña y prueba aparte (sección 5).
