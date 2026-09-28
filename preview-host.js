const frame = document.getElementById("web-preview-frame");
const phone = document.getElementById("preview-phone");
const deviceSize = document.getElementById("device-size");
const uploadControls = document.getElementById("upload-controls");
const aiaFile = document.getElementById("aia-file");
const screenChoice = document.getElementById("screen-choice");
const screenChoiceLabel = document.getElementById("screen-choice-label");
const launchStatus = document.getElementById("launch-status");
const compatibilityDetails = document.getElementById("compatibility-details");
const compatibilityMessage = document.getElementById("compatibility-message");
const supportedList = document.getElementById("supported-features");
const unsupportedList = document.getElementById("unsupported-features");
const androidOnlySection = document.getElementById("android-only-section");
const androidOnlyList = document.getElementById("android-only-features");
const query = new URLSearchParams(window.location.search);
const embedded = query.get("embedded") === "1";
const parentOrigin = query.get("parentOrigin") || "";
const editorToken = query.get("editorToken") || "";
const validEmbeddedParent = embedded && window.parent !== window && editorToken !== "" &&
    isAllowedParentOrigin(parentOrigin);

let projectModel = null;
let frameReady = false;
let lastLaunchRequest = null;
let uploadedScreens = new Map();
let uploadGeneration = 0;
deviceSize.addEventListener("change", () => {
  phone.dataset.size = deviceSize.value;
});
if (validEmbeddedParent) {
  document.body.classList.add("embedded");
  uploadControls.hidden = true;
} else {
  launchStatus.textContent = "Choose an .aia file to start.";
}
document.getElementById("preview-workspace").hidden = false;
frame.src = runtimeUrl();

aiaFile.addEventListener("change", async () => {
  const generation = ++uploadGeneration;
  projectModel = null;
  uploadedScreens = new Map();
  screenChoice.hidden = true;
  screenChoiceLabel.hidden = true;
  const file = aiaFile.files?.[0];
  if (!file) return;
  try {
    if (!file.name.toLowerCase().endsWith(".aia") || file.size > 20_000_000) {
      throw new Error("Choose an .aia file smaller than 20 MB.");
    }
    if (typeof JSZip === "undefined") throw new Error("The .aia reader did not load.");
    setLoading("Reading .aia file…");
    const archive = await JSZip.loadAsync(file);
    if (generation !== uploadGeneration) return;
    const entries = Object.values(archive.files);
    if (entries.length > 300) throw new Error("This .aia has too many files for Web Preview.");
    for (const entry of entries) {
      const match = /^src\/.*\/([^/]+)\.scm$/i.exec(entry.name);
      if (!match || entry.dir) continue;
      const bky = archive.file(entry.name.replace(/\.scm$/i, ".bky"));
      uploadedScreens.set(match[1], { scm: entry, bky });
    }
    if (uploadedScreens.size === 0) throw new Error("This .aia contains no App Inventor screens.");
    screenChoice.replaceChildren(...Array.from(uploadedScreens.keys(), name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      return option;
    }));
    screenChoice.value = uploadedScreens.has("Screen1") ? "Screen1" : uploadedScreens.keys().next().value;
    screenChoice.hidden = uploadedScreens.size < 2;
    screenChoiceLabel.hidden = uploadedScreens.size < 2;
    await loadUploadedScreen(generation);
  } catch (error) {
    if (generation === uploadGeneration) showSourceError(error);
  }
});

screenChoice.addEventListener("change", () => {
  loadUploadedScreen(uploadGeneration).catch(showSourceError);
});

async function loadUploadedScreen(generation) {
  const source = uploadedScreens.get(screenChoice.value);
  if (!source) throw new Error("Choose a screen from this .aia file.");
  setLoading("Loading screen…");
  const [scm, blocks] = await Promise.all([
    source.scm.async("string"),
    source.bky ? source.bky.async("string") : Promise.resolve("<xml></xml>")
  ]);
  if (generation !== uploadGeneration) return;
  if (scm.length > 500_000 || blocks.length > 500_000) {
    throw new Error("This screen is too large for Web Preview.");
  }
  loadSource(scm, blocks);
}

frame.addEventListener("load", () => {
  frameReady = false;
  sendPing();
});

window.addEventListener("message", event => {
  if (isEditorMessage(event)) {
    const message = event.data;
    if (!message || message.type !== "webpreview:launch-source" || message.version !== 1 ||
        typeof message.requestId !== "string") return;
    if (message.requestId === lastLaunchRequest) {
      acknowledgeLaunch(message.requestId, event.source, event.origin);
      return;
    }
    lastLaunchRequest = message.requestId;
    try {
      loadSource(message.scm, message.blocks);
      acknowledgeLaunch(message.requestId, event.source, event.origin);
    } catch (error) {
      showSourceError(error);
    }
    return;
  }

  if (event.source !== frame.contentWindow || event.origin !== "null") return;
  const message = event.data;
  if (!message || message.version !== 1) return;
  if (message.type === "webpreview:ready") {
    frameReady = true;
    sendProject();
    return;
  }
  if (message.type !== "webpreview:status" || typeof message.status !== "string") return;
  launchStatus.textContent = message.status.slice(0, 500);
  launchStatus.dataset.kind = message.status === "Preview running." ? "ready" : "error";
});

if (validEmbeddedParent) {
  postToEditor({ type: "webpreview:ready", version: 1 });
  sendPing();
}

function acknowledgeLaunch(requestId, targetWindow, targetOrigin) {
  targetWindow.postMessage({
    type: "webpreview:loaded",
    version: 1,
    editorToken,
    requestId
  }, targetOrigin);
}

function isAllowedParentOrigin(origin) {
  try {
    return new URL(origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function isEditorMessage(event) {
  // GWT's compiled editor can send from its same-origin code frame rather than the top window.
  return validEmbeddedParent && event.source && event.origin === parentOrigin &&
      event.data && event.data.editorToken === editorToken;
}

function postToEditor(message, targetOrigin = parentOrigin) {
  if (validEmbeddedParent) window.parent.postMessage(message, targetOrigin);
}

function sendProject() {
  if (!frameReady || !projectModel) return;
  frame.contentWindow.postMessage({ type: "webpreview:launch", version: 1, project: projectModel }, "*");
}

function sendPing() {
  frame.contentWindow?.postMessage({ type: "webpreview:ping", version: 1 }, "*");
}

function runtimeUrl() {
  return new URL("./runtime/preview.html", window.location.href).href;
}

function loadSource(scm, blocks) {
  projectModel = WebPreview.adaptProject(scm, blocks);
  phone.dataset.orientation = projectModel.screen.properties.ScreenOrientation === "landscape"
    ? "landscape" : "portrait";
  showCompatibility(WebPreview.analyzeCompatibility(projectModel));
  setLoading("Loading preview…");
  if (frameReady) sendProject();
}

function setLoading(message) {
  launchStatus.textContent = message;
  launchStatus.dataset.kind = "waiting";
}

function showSourceError(error) {
  projectModel = null;
  compatibilityMessage.textContent = "Compatibility could not be checked because the project could not be read.";
  compatibilityDetails.hidden = true;
  supportedList.replaceChildren();
  unsupportedList.replaceChildren();
  androidOnlyList.replaceChildren();
  androidOnlySection.hidden = true;
  launchStatus.textContent = error instanceof Error ? error.message : "Web Preview could not read this project.";
  launchStatus.dataset.kind = "error";
}

function showCompatibility(report) {
  compatibilityDetails.hidden = report.unsupported.length === 0;
  compatibilityDetails.open = false;
  compatibilityDetails.querySelector("summary").textContent =
      `Preview limits (${report.unsupported.length})`;
  compatibilityMessage.textContent = report.message;
  fillList(supportedList, report.supported);
  fillList(unsupportedList, report.unsupported);
  fillList(androidOnlyList, report.androidOnly);
  androidOnlySection.hidden = report.androidOnly.length === 0;
  if (report.unsupported.length === 0) {
    const item = document.createElement("li");
    item.textContent = "None detected";
    unsupportedList.appendChild(item);
  }
}

function fillList(list, values) {
  list.replaceChildren();
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.appendChild(item);
  }
}
