(function (WebPreview) {
const { COMPONENTS } = WebPreview;

const SCREEN_CLASS = "webpreview-screen";

function renderScreen(document, mount, project) {
  mount.replaceChildren();
  const byName = new Map();
  const screenElement = document.createElement("section");
  screenElement.className = SCREEN_CLASS;
  screenElement.setAttribute("aria-label", "App Inventor screen preview");
  screenElement.dataset.componentName = project.screen.name;
  screenElement.dataset.componentType = "Form";
  applyProperties(screenElement, project.screen, COMPONENTS.get("Form"));

  const title = project.screen.properties.Title;
  let heading = null;
  if (project.screen.properties.TitleVisible !== "False" && typeof title === "string" && title.length > 0) {
    heading = document.createElement("h1");
    heading.className = "webpreview-title";
    heading.textContent = title;
    screenElement.appendChild(heading);
  }
  byName.set(project.screen.name, {
    component: project.screen,
    adapter: COMPONENTS.get("Form"),
    element: screenElement,
    titleElement: heading || null
  });

  for (const child of project.screen.children) {
    screenElement.appendChild(renderComponent(document, child, byName));
  }
  mount.appendChild(screenElement);
  return { screenElement, components: byName };
}

function renderComponent(document, component, byName) {
  const adapter = COMPONENTS.get(component.type);
  if (!adapter) {
    const placeholder = document.createElement("div");
    placeholder.className = "webpreview-unsupported";
    placeholder.textContent = `Unsupported component: ${component.type} (${component.name})`;
    placeholder.dataset.componentName = component.name;
    for (const child of component.children) {
      placeholder.appendChild(renderComponent(document, child, byName));
    }
    return placeholder;
  }

  const element = document.createElement(adapter.element);
  element.className = `webpreview-component webpreview-${component.type.toLowerCase()}`;
  element.dataset.componentName = component.name;
  element.dataset.componentType = component.type;
  if (component.type === "Button") element.type = "button";
  if (component.type === "TextBox") element.type = "text";
  if (component.type === "PasswordTextBox") { element.type = "password"; element.autocomplete = "off"; }
  if (adapter.nonVisible) element.hidden = true;
  applyProperties(element, component, adapter);
  byName.set(component.name, { component, adapter, element });
  for (const child of component.children) {
    element.appendChild(renderComponent(document, child, byName));
  }
  return element;
}

function applyProperty(instance, property, value) {
  if (!instance.adapter.properties.has(property)) {
    throw new Error(`Web Preview does not support property ${instance.component.name}.${property}.`);
  }
  instance.component.properties[property] = value;
  if (property === "Title") {
    const text = safeText(value);
    if (instance.titleElement && text) instance.titleElement.textContent = text;
    else if (instance.titleElement) {
      instance.titleElement.remove();
      instance.titleElement = null;
    } else if (text) {
      const heading = instance.element.ownerDocument.createElement("h1");
      heading.className = "webpreview-title";
      heading.textContent = text;
      instance.element.prepend(heading);
      instance.titleElement = heading;
    }
  } else {
    if (!instance.adapter.nonVisible) applyPropertyToElement(instance.element, property, value);
  }
}

function readProperty(instance, property) {
  if (!instance.adapter.properties.has(property)) {
    throw new Error(`Web Preview does not support property ${instance.component.name}.${property}.`);
  }
  if (property === "Text" && instance.element.tagName === "INPUT") {
    return instance.element.value;
  }
  if (property === "Selection" && instance.element.tagName === "SELECT") {
    return instance.element.value;
  }
  if (Object.hasOwn(instance.component.properties, property)) {
    return instance.component.properties[property];
  }
  return instance.adapter.defaults[property] ?? "";
}

function applyProperties(element, component, adapter) {
  for (const [property, value] of Object.entries(component.properties)) {
    if (component.type === "Spinner" && property === "Selection") continue;
    // Dynamic Android orientation modes need a device sensor; keep the rest of the screen usable.
    if (component.type === "Form" && property === "ScreenOrientation" &&
        !["portrait", "landscape", "unspecified"].includes(String(value))) continue;
    if (adapter.properties.has(property)) applyPropertyToElement(element, property, value);
  }
  for (const [property, value] of Object.entries(adapter.defaults)) {
    if (!Object.hasOwn(component.properties, property)) applyPropertyToElement(element, property, value);
  }
  if (component.type === "Spinner" && Object.hasOwn(component.properties, "Selection")) {
    applyPropertyToElement(element, "Selection", component.properties.Selection);
  }
}

function applyPropertyToElement(element, property, value) {
  switch (property) {
    case "Title":
      break;
    case "Text":
      if (element.tagName === "INPUT") element.value = safeText(value);
      else element.textContent = safeText(value);
      break;
    case "Hint":
      element.placeholder = safeText(value);
      break;
    case "ElementsFromString":
      if (element.tagName === "SELECT") {
        const values = safeText(value);
        element.replaceChildren(...(values ? values.split(/ *, */).map(item => {
          const option = element.ownerDocument.createElement("option");
          option.value = item;
          option.textContent = item;
          return option;
        }) : []));
      }
      break;
    case "Selection":
      if (element.tagName === "SELECT") element.value = safeText(value);
      break;
    case "Visible":
      element.hidden = !toBoolean(value);
      break;
    case "Enabled":
      if ("disabled" in element) element.disabled = !toBoolean(value);
      break;
    case "Width":
      element.style.width = dimension(value);
      break;
    case "Height":
      element.style.height = dimension(value);
      // An explicit App Inventor height also applies to short spacer labels.
      // The browser's default label min-height must not stretch those spacers.
      element.style.minHeight = Number(value) >= 0 ? "0" : "";
      break;
    case "AlignHorizontal": {
      const alignment = horizontalAlignment(value);
      if (!alignment) throw new Error("Web Preview could not read this AlignHorizontal value.");
      element.style.display = "flex";
      element.style.flexDirection = "column";
      element.style.alignItems = alignment;
      break;
    }
    case "ActionBar":
      element.classList.toggle("webpreview-actionbar", toBoolean(value));
      break;
    case "ScreenOrientation": {
      const orientation = String(value);
      if (!["portrait", "landscape", "unspecified"].includes(orientation)) {
        throw new Error(`Web Preview does not support ScreenOrientation ${orientation}.`);
      }
      element.dataset.orientation = orientation;
      break;
    }
    case "BackgroundColor": {
      const color = colorValue(value);
      if (!color) throw new Error("Web Preview could not read this BackgroundColor value.");
      element.style.backgroundColor = color;
      break;
    }
    case "TextColor": {
      const color = colorValue(value);
      if (!color) throw new Error("Web Preview could not read this TextColor value.");
      element.style.color = color;
      break;
    }
    case "FontSize": {
      const size = Number(value);
      if (!Number.isFinite(size) || size < 1 || size > 96) {
        throw new Error("Web Preview supports font sizes from 1 to 96.");
      }
      element.style.fontSize = `${size}px`;
      break;
    }
    case "FontTypeface": {
      const fonts = { "0": "Roboto, Arial, sans-serif", "1": "Arial, sans-serif",
        "2": "Georgia, serif", "3": "monospace" };
      const font = fonts[String(value)];
      if (!font) throw new Error("Web Preview does not support this FontTypeface value.");
      element.style.fontFamily = font;
      break;
    }
    case "Shape": {
      const radii = { "0": "5px", "1": "12px", "2": "0", "3": "999px" };
      const radius = radii[String(value)];
      if (radius === undefined) throw new Error("Web Preview does not support this Button Shape value.");
      element.style.borderRadius = radius;
      break;
    }
    case "FontBold":
      element.style.fontWeight = toBoolean(value) ? "700" : "400";
      break;
    case "FontItalic":
      element.style.fontStyle = toBoolean(value) ? "italic" : "normal";
      break;
    case "TextAlignment": {
      const alignment = textAlignment(value);
      if (!alignment) throw new Error("Web Preview could not read this TextAlignment value.");
      element.style.textAlign = alignment;
      break;
    }
    default:
      break;
  }
}

function safeText(value) {
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  throw new Error("Web Preview only accepts text, numbers, and booleans for this property.");
}

function toBoolean(value) {
  if (value === true || value === "True" || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "False" || value === "false" || value === 0 || value === "0") return false;
  throw new Error("Web Preview could not read this boolean property value.");
}

function dimension(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new Error("Web Preview expects an automatic, fill-parent, or whole-number size.");
  }
  if (number === -1) return "auto";
  if (number === -2) return "100%";
  if (number <= -1000 && number >= -1100) return `${-number - 1000}%`;
  if (number < 0 || number > 10_000) throw new Error("Web Preview size is outside the supported range.");
  return `${number}px`;
}

function horizontalAlignment(value) {
  return { "1": "flex-start", "2": "flex-end", "3": "center" }[String(value)] || "";
}

function textAlignment(value) {
  const alignments = new Map([
    ["0", "left"], ["1", "center"], ["2", "right"],
    ["Left", "left"], ["Center", "center"], ["Right", "right"]
  ]);
  return alignments.get(String(value)) || "";
}

function colorValue(value) {
  const text = String(value);
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(text)) return text;
  const hex = text.match(/^&H([0-9a-f]{8})$/i);
  if (hex) return argbToCss(Number.parseInt(hex[1], 16));
  if (/^-?\d+$/.test(text)) return argbToCss(Number(text) >>> 0);
  return "";
}

function argbToCss(argb) {
  const alpha = ((argb >>> 24) & 0xff) / 255;
  const red = (argb >>> 16) & 0xff;
  const green = (argb >>> 8) & 0xff;
  const blue = argb & 0xff;
  return alpha >= 1 ? `rgb(${red} ${green} ${blue})` : `rgb(${red} ${green} ${blue} / ${alpha})`;
}

Object.assign(WebPreview, { renderScreen, applyProperty, readProperty });
})(globalThis.WebPreview ||= {});
