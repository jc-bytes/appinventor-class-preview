const frame = document.getElementById("web-preview-frame");
const phone = document.getElementById("preview-phone");
const deviceSize = document.getElementById("device-size");
const uploadControls = document.getElementById("upload-controls");
const aiaFile = document.getElementById("aia-file");
const screenChoice = document.getElementById("screen-choice");
const screenChoiceLabel = document.getElementById("screen-choice-label");
const launchStatus = document.getElementById("launch-status");
const saveScreenshot = document.getElementById("save-screenshot");
const captureStatus = document.getElementById("capture-status");
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
let captureRequest = null;
let captureCount = 0;
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
  saveScreenshot.disabled = true;
  captureStatus.textContent = "";
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
  if (message.type === "webpreview:capture-result") {
    if (!captureRequest || message.requestId !== captureRequest.id) return;
    const request = captureRequest;
    captureRequest = null;
    window.clearTimeout(request.timeout);
    if (typeof message.png === "string" && message.png.startsWith("data:image/png;base64,") &&
        message.png.length < 10_000_000) request.resolve(message.png);
    else request.reject(new Error(typeof message.error === "string" ? message.error :
      "The preview could not capture this screen."));
    return;
  }
  if (message.type !== "webpreview:status" || typeof message.status !== "string") return;
  launchStatus.textContent = message.status.slice(0, 500);
  launchStatus.dataset.kind = message.status === "Preview running." ? "ready" : "error";
  saveScreenshot.disabled = launchStatus.dataset.kind !== "ready";
});

saveScreenshot.addEventListener("click", async () => {
  if (!projectModel || !frameReady || captureRequest) return;
  saveScreenshot.disabled = true;
  captureStatus.textContent = "Saving screenshot…";
  try {
    const png = await requestScreenCapture();
    const canvas = await drawPhoneScreenshot(png);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result =>
      result ? resolve(result) : reject(new Error("PNG export failed.")), "image/png"));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectModel.screen.name}-preview.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    captureStatus.textContent = "Screenshot saved as PNG.";
  } catch (error) {
    captureStatus.textContent = error instanceof Error ? error.message : "Screenshot could not be saved.";
  } finally {
    saveScreenshot.disabled = launchStatus.dataset.kind !== "ready";
  }
});

function requestScreenCapture() {
  return new Promise((resolve, reject) => {
    const id = `capture-${++captureCount}`;
    const timeout = window.setTimeout(() => {
      captureRequest = null;
      reject(new Error("Screenshot timed out. Try again."));
    }, 10000);
    captureRequest = { id, timeout, resolve, reject };
    frame.contentWindow.postMessage({ type: "webpreview:capture", version: 1, requestId: id }, "*");
  });
}

async function drawPhoneScreenshot(screenPng) {
  const phoneRect = phone.getBoundingClientRect();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(phoneRect.width * scale);
  canvas.height = Math.round(phoneRect.height * scale);
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, phoneRect.width, phoneRect.height);

  const frameUrl = getComputedStyle(phone).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
  if (!frameUrl) throw new Error("The phone frame could not be captured.");
  const statusImage = phone.querySelector(".phone-status img");
  const [frameArt, screenArt, statusArt] = await Promise.all([
    loadImage(frameUrl), loadImage(screenPng), loadImage(statusImage.src)
  ]);
  context.drawImage(frameArt, 0, 0, phoneRect.width, phoneRect.height);

  const rect = element => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x - phoneRect.x, y: bounds.y - phoneRect.y,
      width: bounds.width, height: bounds.height };
  };
  const display = rect(phone.querySelector(".phone-display"));
  const status = rect(phone.querySelector(".phone-status"));
  const preview = rect(frame);
  const navigation = rect(phone.querySelector(".phone-navigation"));
  const statusIcon = rect(statusImage);
  context.fillStyle = "#fff";
  context.fillRect(display.x, display.y, display.width, display.height);
  context.fillStyle = "#3f51b5";
  context.fillRect(status.x, status.y, status.width, status.height);
  context.drawImage(statusArt, statusIcon.x, statusIcon.y, statusIcon.width, statusIcon.height);
  context.drawImage(screenArt, preview.x, preview.y, preview.width, preview.height);
  context.fillStyle = "#000";
  context.fillRect(navigation.x, navigation.y, navigation.width, navigation.height);
  drawNavigation(context, navigation);
  return canvas;
}

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

function drawNavigation(context, bar) {
  const centerY = bar.y + bar.height / 2;
  const centers = [bar.x + bar.width / 6, bar.x + bar.width / 2,
    bar.x + bar.width * 5 / 6];
  context.strokeStyle = "#fff";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(centers[0] + 5, centerY - 9);
  context.lineTo(centers[0] - 4, centerY);
  context.lineTo(centers[0] + 5, centerY + 9);
  context.stroke();
  context.beginPath();
  context.arc(centers[1], centerY, 8, 0, Math.PI * 2);
  context.stroke();
  context.strokeRect(centers[2] - 8, centerY - 8, 16, 16);
}

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
  return new URL("./runtime/preview.html?v=5", window.location.href).href;
}

function loadSource(scm, blocks) {
  projectModel = WebPreview.adaptProject(scm, blocks);
  saveScreenshot.disabled = true;
  captureStatus.textContent = "";
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
  saveScreenshot.disabled = true;
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
