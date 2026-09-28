(function (WebPreview) {
const { BLOCKS, COMPONENTS } = WebPreview;

const BLOCK_LABELS = new Map([
  ["component_event", "component events"],
  ["component_set_get", "component property blocks"],
  ["text", "text literals"],
  ["math_number", "number literals"],
  ["logic_boolean", "boolean literals"],
  ["global_declaration", "global variables"],
  ["lexical_variable_get", "global variable reads"],
  ["lexical_variable_set", "global variable writes"],
  ["text_join", "text joining"]
]);

function analyzeCompatibility(project) {
  const supported = [];
  const unsupported = [];

  const visit = component => {
    const label = `${component.name} (${component.type === "Form" ? "Screen" : component.type})`;
    if (COMPONENTS.has(component.type)) supported.push(label);
    else unsupported.push(`Component ${label}`);

    component.children.forEach(visit);
  };
  visit(project.screen);

  for (const event of project.program.events) {
    const component = findComponent(project.screen, event.component);
    const adapter = component && COMPONENTS.get(component.type);
    const label = `${event.component}.${event.event}`;
    if (adapter?.events.has(event.event)) supported.push(label);
    else unsupported.push(`Event ${label}`);
  }

  for (const blockType of project.features.blockTypes) {
    if (BLOCKS.has(blockType)) {
      const label = BLOCK_LABELS.get(blockType) || `block ${blockType}`;
      if (!supported.includes(label)) supported.push(label);
    }
  }
  for (const blockType of project.features.unsupportedBlocks) {
    unsupported.push(`Blockly block ${blockType}`);
  }
  for (const { component, property } of project.features.unsupportedProperties) {
    unsupported.push(`Property ${component}.${property}`);
  }
  const androidOnly = (project.features.buildOnlyProperties || []).map(({ component, property }) =>
    `${component}.${property}: installed app label; no effect on the preview screen`);
  for (const blockType of project.features.unsupportedOperations) {
    unsupported.push(`Blockly operation ${blockType}`);
  }
  for (const event of project.features.unsupportedEvents) {
    unsupported.push(`Event ${event.component}.${event.event}`);
  }

  return {
    supported: unique(supported),
    unsupported: unique(unsupported),
    androidOnly: unique(androidOnly),
    message: unsupported.length === 0
      ? androidOnly.length > 0
        ? "All detected screen and block features are supported. Android build settings are listed separately."
        : "Every detected feature in this project is supported by the current Web Preview."
      : `Web Preview does not currently support ${unique(unsupported).length} feature${unique(unsupported).length === 1 ? "" : "s"} in this project. The rest of the project can still be previewed where possible. Use the Android Companion for full testing.`
  };
}

function findComponent(component, name) {
  if (component.name === name) return component;
  for (const child of component.children) {
    const found = findComponent(child, name);
    if (found) return found;
  }
  return null;
}

function unique(items) {
  return Array.from(new Set(items));
}

Object.assign(WebPreview, { analyzeCompatibility });
})(globalThis.WebPreview ||= {});
