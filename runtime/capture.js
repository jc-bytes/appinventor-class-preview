(function (WebPreview) {
async function captureScreen(document, mount) {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  if (!mount.firstElementChild || width < 1 || height < 1 || width > 2000 || height > 2000) {
    throw new Error("There is no preview screen to capture.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  context.scale(2, 2);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.beginPath();
  context.rect(0, 0, width, height);
  context.clip();
  paintElement(context, mount);
  return canvas.toDataURL("image/png");
}

function paintElement(context, element) {
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  context.save();
  paintBox(context, rect, style);

  if (style.overflowX !== "visible" || style.overflowY !== "visible") {
    context.beginPath();
    context.rect(rect.left, rect.top, rect.width, rect.height);
    context.clip();
  }
  if (element.tagName === "SELECT") {
    paintControlText(context, element.value, rect, style);
    context.strokeStyle = style.color;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(rect.right - 19, rect.top + rect.height / 2 - 3);
    context.lineTo(rect.right - 14, rect.top + rect.height / 2 + 2);
    context.lineTo(rect.right - 9, rect.top + rect.height / 2 - 3);
    context.stroke();
  } else if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    paintControlText(context, element.value || element.placeholder || "", rect, style,
      !element.value ? "#777" : style.color);
  } else {
    for (const child of element.childNodes) {
      if (child.nodeType === 1) paintElement(context, child);
      else if (child.nodeType === 3) paintTextNode(context, child, style);
    }
  }
  context.restore();
}

function paintBox(context, rect, style) {
  const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2);
  if (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent") {
    roundedPath(context, rect.left, rect.top, rect.width, rect.height, radius);
    context.fillStyle = style.backgroundColor;
    context.fill();
  }
  const border = parseFloat(style.borderTopWidth) || 0;
  if (border > 0 && style.borderTopStyle !== "none") {
    roundedPath(context, rect.left + border / 2, rect.top + border / 2,
      rect.width - border, rect.height - border, Math.max(0, radius - border / 2));
    context.lineWidth = border;
    context.strokeStyle = style.borderTopColor;
    context.stroke();
  }
}

function roundedPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, Math.max(0, width), Math.max(0, height), radius);
}

function paintTextNode(context, node, style) {
  const text = node.textContent;
  if (!text || !text.trim()) return;
  setTextStyle(context, style);
  const range = node.ownerDocument.createRange();
  let offset = 0;
  for (const grapheme of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    const length = grapheme.segment.length;
    range.setStart(node, offset);
    range.setEnd(node, offset + length);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && grapheme.segment.trim()) {
      context.fillText(grapheme.segment, rect.left, rect.top);
    }
    offset += length;
  }
  range.detach();
}

function paintControlText(context, text, rect, style, color = style.color) {
  setTextStyle(context, style);
  context.fillStyle = color;
  const padding = parseFloat(style.paddingLeft) || 8;
  const fontSize = parseFloat(style.fontSize) || 14;
  const x = rect.left + padding;
  const y = rect.top + (rect.height - fontSize) / 2 - 1;
  context.fillText(String(text), x, y, rect.width - padding - 25);
}

function setTextStyle(context, style) {
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.fillStyle = style.color;
  context.textBaseline = "top";
}

WebPreview.captureScreen = captureScreen;
})(globalThis.WebPreview ||= {});
