(function (WebPreview) {
const { BLOCKS, COMPONENTS, COMPONENT_METADATA_PROPERTIES, FORM_BUILD_ONLY_PROPERTIES, FORM_EDITOR_ONLY_PROPERTIES, LIMITS } = WebPreview;

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const GLOBAL_PREFIX = "global ";

function globalName(value) {
  if (typeof value !== "string" || !value.startsWith(GLOBAL_PREFIX)) return null;
  const name = value.slice(GLOBAL_PREFIX.length);
  return NAME_PATTERN.test(name) ? name : null;
}

function parseScm(source) {
  if (typeof source === "object" && source !== null) {
    return validateFormDocument(source);
  }
  if (typeof source !== "string" || source.length > LIMITS.sourceCharacters) {
    throw new Error("Screen source is missing or too large.");
  }

  let jsonText = source;
  const marker = "$JSON\n";
  const start = source.lastIndexOf(marker);
  if (start !== -1) {
    const jsonStart = start + marker.length;
    const end = source.lastIndexOf("\n|#");
    if (end < jsonStart) {
      throw new Error("Screen source has no closing |# marker.");
    }
    jsonText = source.slice(jsonStart, end);
  }

  let document;
  try {
    document = JSON.parse(jsonText);
  } catch {
    throw new Error("Screen source does not contain valid JSON.");
  }
  return validateFormDocument(document);
}

function validateFormDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Screen source must be a JSON object.");
  }
  const properties = document.Properties ?? document.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error("Screen source has no Properties object.");
  }
  return properties;
}

function elementName(element) {
  return (element.localName || element.nodeName || "").split(":").pop();
}

function directChildren(element, wantedName) {
  return Array.from(element.childNodes || []).filter(child =>
    child.nodeType === 1 && elementName(child) === wantedName);
}

function childByName(element, wantedName, attributeName, attributeValue) {
  return directChildren(element, wantedName).find(child =>
    attributeName === undefined || child.getAttribute(attributeName) === attributeValue) || null;
}

function fieldValue(block, name) {
  const field = childByName(block, "field", "name", name) || childByName(block, "title", "name", name);
  return field ? field.textContent : null;
}

function blockFromInput(block, inputName) {
  const input = childByName(block, "value", "name", inputName);
  if (!input) return null;
  return directChildren(input, "block")[0] || directChildren(input, "shadow")[0] || null;
}

function propertyMutation(block) {
  return directChildren(block, "mutation")[0] || null;
}

function convertBlock(block, state, depth) {
  if (depth > LIMITS.blockDepth) {
    throw new Error("Blocks are nested too deeply for Web Preview.");
  }
  state.count += 1;
  if (state.count > LIMITS.blocks) {
    throw new Error("This project has too many blocks for Web Preview.");
  }
  const type = block.getAttribute("type") || "(missing type)";
  state.seenTypes.add(type);

  if (type === "text") {
    const value = fieldValue(block, "TEXT");
    return value === null ? unsupported(type, state) : { kind: "literal", value };
  }
  if (type === "math_number") {
    const value = Number(fieldValue(block, "NUM"));
    return Number.isFinite(value) ? { kind: "literal", value } : unsupported(type, state);
  }
  if (type === "logic_boolean") {
    const value = fieldValue(block, "BOOL");
    return value === "TRUE" || value === "FALSE"
      ? { kind: "literal", value: value === "TRUE" }
      : unsupported(type, state);
  }
  if (type === "global_declaration") {
    const name = fieldValue(block, "NAME");
    const value = blockFromInput(block, "VALUE");
    if (!NAME_PATTERN.test(name || "") || !value) return unsupported(type, state);
    return { kind: "global", name, value: convertBlock(value, state, depth + 1) };
  }
  if (type === "lexical_variable_get") {
    const name = globalName(fieldValue(block, "VAR"));
    return name ? { kind: "getGlobal", name } : unsupported(type, state);
  }
  if (type === "lexical_variable_set") {
    const name = globalName(fieldValue(block, "VAR"));
    const value = blockFromInput(block, "VALUE");
    if (!name || !value) return unsupported(type, state);
    return { kind: "setGlobal", name, value: convertBlock(value, state, depth + 1) };
  }
  if (type === "text_join") {
    const count = Number(propertyMutation(block)?.getAttribute("items") ?? 2);
    if (!Number.isInteger(count) || count < 0 || count > 100) return unsupported(type, state);
    const values = [];
    for (let i = 0; i < count; i++) {
      const value = blockFromInput(block, `ADD${i}`);
      values.push(value ? convertBlock(value, state, depth + 1) : { kind: "literal", value: "" });
    }
    return { kind: "joinText", values };
  }
  if (type === "component_set_get") {
    const mutation = propertyMutation(block);
    if (!mutation || mutation.getAttribute("is_generic") === "true") return unsupported(type, state);
    const component = mutation.getAttribute("instance_name") || fieldValue(block, "COMPONENT_SELECTOR");
    const property = mutation.getAttribute("property_name") || fieldValue(block, "PROP");
    if (!component || !property) return unsupported(type, state);
    if (mutation.getAttribute("set_or_get") === "get") {
      return { kind: "getProperty", component, property };
    }
    if (mutation.getAttribute("set_or_get") === "set") {
      const valueBlock = blockFromInput(block, "VALUE");
      if (!valueBlock) return unsupported(type, state);
      return {
        kind: "setProperty",
        component,
        property,
        value: convertBlock(valueBlock, state, depth + 1)
      };
    }
    return unsupported(type, state);
  }
  if (type === "component_event") {
    const mutation = propertyMutation(block);
    if (!mutation || mutation.getAttribute("is_generic") === "true") return unsupported(type, state);
    const component = mutation.getAttribute("instance_name") || fieldValue(block, "COMPONENT_SELECTOR");
    const componentType = mutation.getAttribute("component_type");
    const event = mutation.getAttribute("event_name");
    if (!component || !componentType || !event) return unsupported(type, state);
    const statement = childByName(block, "statement", "name", "DO");
    const first = statement && (directChildren(statement, "block")[0] || directChildren(statement, "shadow")[0]);
    return {
      kind: "event",
      component,
      componentType,
      event,
      body: first ? convertStatementChain(first, state, depth + 1) : []
    };
  }

  return unsupported(type, state);
}

function unsupported(blockType, state) {
  state?.unsupportedBlocks.add(blockType);
  return { kind: "unsupported", blockType };
}

function convertStatementChain(firstBlock, state, depth) {
  const statements = [];
  let block = firstBlock;
  while (block) {
    if (statements.length >= LIMITS.blocks) {
      throw new Error("This project has too many blocks for Web Preview.");
    }
    const converted = convertBlock(block, state, depth);
    statements.push(converted.kind === "getProperty"
      ? unsupported(block.getAttribute("type"))
      : converted);
    const next = childByName(block, "next");
    block = next && (directChildren(next, "block")[0] || directChildren(next, "shadow")[0]);
  }
  return statements;
}

function parseBlocks(source, { DOMParserClass = globalThis.DOMParser } = {}) {
  if (typeof source !== "string" || source.length > LIMITS.sourceCharacters) {
    throw new Error("Blocks source is missing or too large.");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw new Error("Blocks source cannot contain DTD or entity declarations.");
  }
  if (typeof DOMParserClass !== "function") {
    throw new Error("Web Preview needs a browser XML parser.");
  }

  let document;
  try {
    document = new DOMParserClass().parseFromString(source, "application/xml");
  } catch {
    throw new Error("Blocks source is not valid XML.");
  }
  if (!document.documentElement || elementName(document.documentElement) !== "xml" ||
      document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Blocks source is not valid Blockly XML.");
  }

  const state = { seenTypes: new Set(), unsupportedBlocks: new Set(), count: 0 };
  const roots = directChildren(document.documentElement, "block");
  if (roots.length > LIMITS.blocks) {
    throw new Error("This project has too many blocks for Web Preview.");
  }
  const events = [];
  const globals = [];
  const unsupportedBlocks = [];
  for (const block of roots) {
    const converted = convertBlock(block, state, 0);
    if (converted.kind === "event") {
      events.push(converted);
    } else if (converted.kind === "global") {
      if (globals.some(global => global.name === converted.name)) {
        state.unsupportedBlocks.add("global_declaration (duplicate name)");
      } else {
        globals.push(converted);
      }
    } else if (converted.kind === "unsupported") {
      state.unsupportedBlocks.add(converted.blockType);
    } else if (converted.kind === "getProperty" || converted.kind === "setProperty") {
      // Property blocks have execution meaning only when connected to a supported event.
      state.unsupportedBlocks.add(block.getAttribute("type") || "(missing type)");
    }
  }
  for (const blockType of state.seenTypes) {
    if (!BLOCKS.has(blockType)) state.unsupportedBlocks.add(blockType);
  }
  unsupportedBlocks.push(...state.unsupportedBlocks);
  return { events, globals, blockTypes: Array.from(state.seenTypes), unsupportedBlocks };
}

function normalizeComponent(properties, state, depth) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error("A component in Screen source is not an object.");
  }
  if (depth > LIMITS.componentDepth) {
    throw new Error("Screen components are nested too deeply for Web Preview.");
  }
  state.count += 1;
  if (state.count > LIMITS.components) {
    throw new Error("This project has too many components for Web Preview.");
  }

  const name = properties.$Name;
  const type = properties.$Type;
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || typeof type !== "string" || type.length > 80) {
    throw new Error("A component has an invalid name or type.");
  }
  if (state.names.has(name)) {
    throw new Error(`The component name ${name} appears more than once.`);
  }
  state.names.add(name);

  const values = Object.create(null);
  for (const [key, value] of Object.entries(properties)) {
    if (COMPONENT_METADATA_PROPERTIES.has(key) || key.startsWith("$") ||
        (type === "Form" && FORM_EDITOR_ONLY_PROPERTIES.has(key))) continue;
    if (["string", "number", "boolean"].includes(typeof value)) {
      values[key] = value;
    } else {
      state.unsupportedProperties.push({ component: name, property: key });
    }
  }
  const supported = COMPONENTS.get(type);
  if (supported) {
    for (const property of Object.keys(values)) {
      if (type === "Form" && FORM_BUILD_ONLY_PROPERTIES.has(property)) {
        state.buildOnlyProperties.push({ component: name, property });
        continue;
      }
      if (type === "Form" && property === "ScreenOrientation" &&
          !["portrait", "landscape", "unspecified"].includes(String(values[property]))) {
        state.unsupportedProperties.push({ component: name, property });
        continue;
      }
      if (!supported.properties.has(property)) {
        state.unsupportedProperties.push({ component: name, property });
      }
    }
  }

  const children = properties.$Components === undefined ? [] : properties.$Components;
  if (!Array.isArray(children)) {
    throw new Error(`The child list for ${name} is not a list.`);
  }
  return {
    name,
    type,
    properties: values,
    children: children.map(child => normalizeComponent(child, state, depth + 1))
  };
}

function adaptProject(scmSource, blocksSource, options = {}) {
  const rootProperties = parseScm(scmSource);
  if (rootProperties.$Type !== "Form") {
    throw new Error("Web Preview expects a Form screen at the project root.");
  }
  const state = { count: 0, names: new Set(), unsupportedProperties: [], buildOnlyProperties: [] };
  const screen = normalizeComponent(rootProperties, state, 0);
  const blocks = parseBlocks(blocksSource, options);
  const components = new Map();
  const collect = component => {
    components.set(component.name, component);
    component.children.forEach(collect);
  };
  collect(screen);

  const unsupportedEvents = [];
  const unsupportedOperations = new Set();
  const globalNames = new Set(blocks.globals.map(global => global.name));
  const checkProperty = (componentName, property) => {
    const component = components.get(componentName);
    const adapter = component && COMPONENTS.get(component.type);
    if (!adapter || !adapter.properties.has(property)) {
      state.unsupportedProperties.push({ component: componentName, property });
    }
  };
  const checkExpression = expression => {
    if (expression.kind === "getProperty") {
      checkProperty(expression.component, expression.property);
    } else if (expression.kind === "getGlobal") {
      if (!globalNames.has(expression.name)) unsupportedOperations.add(`undeclared global ${expression.name}`);
    } else if (expression.kind === "joinText") {
      expression.values.forEach(checkExpression);
    } else if (expression.kind === "unsupported") {
      unsupportedOperations.add(expression.blockType);
    }
  };
  const checkStatements = statements => {
    for (const statement of statements) {
      if (statement.kind === "setProperty") {
        checkProperty(statement.component, statement.property);
        checkExpression(statement.value);
      } else if (statement.kind === "setGlobal") {
        if (!globalNames.has(statement.name)) unsupportedOperations.add(`undeclared global ${statement.name}`);
        checkExpression(statement.value);
      } else if (statement.kind === "unsupported") {
        unsupportedOperations.add(statement.blockType);
      }
    }
  };
  for (const event of blocks.events) {
    const component = components.get(event.component);
    const adapter = component && COMPONENTS.get(component.type);
    if (!component || component.type !== event.componentType || !adapter?.events.has(event.event)) {
      unsupportedEvents.push(event);
    }
    checkStatements(event.body);
  }
  for (const global of blocks.globals) checkExpression(global.value);

  return {
    version: 1,
    screen,
    program: { events: blocks.events, globals: blocks.globals },
    features: {
      blockTypes: blocks.blockTypes,
      unsupportedBlocks: blocks.unsupportedBlocks,
      unsupportedProperties: state.unsupportedProperties,
      buildOnlyProperties: state.buildOnlyProperties,
      unsupportedEvents,
      unsupportedOperations: Array.from(unsupportedOperations)
    }
  };
}

Object.assign(WebPreview, { parseScm, parseBlocks, adaptProject });
})(globalThis.WebPreview ||= {});
