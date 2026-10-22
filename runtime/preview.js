const status = document.getElementById("runtime-status");
const mount = document.getElementById("preview-mount");
let activeRuntime = null;

window.addEventListener("message", event => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (message?.type === "webpreview:ping" && message.version === 1) {
    window.parent.postMessage({ type: "webpreview:ready", version: 1 }, "*");
    return;
  }
  if (message?.type === "webpreview:capture" && message.version === 1) {
    if (!activeRuntime || typeof message.requestId !== "string") return;
    WebPreview.captureScreen(document, mount).then(png => {
      window.parent.postMessage({ type: "webpreview:capture-result", version: 1,
        requestId: message.requestId, png }, "*");
    }).catch(error => {
      window.parent.postMessage({ type: "webpreview:capture-result", version: 1,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : "Screenshot could not be saved." }, "*");
    });
    return;
  }
  if (!message || message.type !== "webpreview:launch" || message.version !== 1) return;

  try {
    const model = WebPreview.validateRuntimeModel(message.project);
    let launchError = false;
    activeRuntime?.dispose();
    activeRuntime = WebPreview.createRuntime({
      document,
      mount,
      project: structuredClone(model),
      onError: error => { launchError = true; showError(error); },
      storage: message.storage || Object.create(null), assets: message.assets || Object.create(null),
      onStore: storage => window.parent.postMessage({type:"webpreview:store", version:1, storage}, "*")
    });
    if (launchError) return;
    setStatus("Preview running.", "ready");
    window.parent.postMessage({ type: "webpreview:status", version: 1, status: "Preview running." }, "*");
  } catch (error) {
    activeRuntime?.dispose();
    activeRuntime = null;
    mount.replaceChildren();
    showError(error instanceof Error ? error.message : "Web Preview could not open this project.");
  }
});

window.parent.postMessage({ type: "webpreview:ready", version: 1 }, "*");

function showError(message) {
  setStatus(message, "error");
  window.parent.postMessage({
    type: "webpreview:status",
    version: 1,
    status: String(message).slice(0, 500)
  }, "*");
}

function setStatus(message, kind) {
  status.textContent = message;
  status.dataset.kind = kind;
}
