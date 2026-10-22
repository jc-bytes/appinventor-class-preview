(function (WebPreview) {
const { LIMITS } = WebPreview;

function validateRuntimeModel(model) {
  if (JSON.stringify(model).length>2000000) throw new Error("Preview model is too large.");
  if (!model || model.version !== 1 || !model.screen || !model.program ||
      !Array.isArray(model.program.events) || !Array.isArray(model.program.globals)) {
    throw new Error("Preview data has an unsupported format.");
  }
  let count = 0;
  const names = new Set();
  const visit = (component, depth) => {
    if (depth > LIMITS.componentDepth || !component || typeof component !== "object") {
      throw new Error("Preview data has an invalid component tree.");
    }
    count += 1;
    if (count > LIMITS.components || typeof component.name !== "string" ||
        typeof component.type !== "string" || !component.properties ||
        typeof component.properties !== "object" || !Array.isArray(component.children)) {
      throw new Error("Preview data has too many or invalid components.");
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(component.name) || names.has(component.name)) {
      throw new Error("Preview data has an invalid or repeated component name.");
    }
    names.add(component.name);
    if (Object.keys(component.properties).length > 100) {
      throw new Error("Preview data contains too many component properties.");
    }
    for (const [key, value] of Object.entries(component.properties)) {
      if (key.length > 100 || !["string", "number", "boolean"].includes(typeof value) ||
          (typeof value === "string" && value.length > 20_000) ||
          (typeof value === "number" && !Number.isFinite(value))) {
        throw new Error("Preview data contains an invalid component property.");
      }
    }
    component.children.forEach(child => visit(child, depth + 1));
  };
  visit(model.screen, 0);
  if (model.screen.type !== "Form") throw new Error("Preview data has no Form screen.");
  if (model.program.events.length + model.program.globals.length > LIMITS.blocks) {
    throw new Error("Preview data contains too many events.");
  }
  const globals = new Set();
  for (const global of model.program.globals) {
    if (global.kind !== "global" || !validName(global.name) || globals.has(global.name)) {
      throw new Error("Preview data contains an invalid global variable.");
    }
    globals.add(global.name);
    validateExpression(global.value, 0);
  }
  if (model.program.procedures !== undefined && (!Array.isArray(model.program.procedures) || model.program.procedures.length > 200)) throw new Error("Invalid procedures.");
  const procedureNames = new Set();
  for (const p of model.program.procedures || []) {
    validateExpression(p,0);
    if (p.kind !== "block" || p.type !== "procedures_defnoreturn" || !validName(p.fields.NAME) || procedureNames.has(p.fields.NAME)) throw new Error("Invalid procedure definition.");
    procedureNames.add(p.fields.NAME);
  }
  for (const event of model.program.events) {
    if (typeof event.component !== "string" || typeof event.componentType !== "string" ||
        typeof event.event !== "string" || !Array.isArray(event.body)) {
      throw new Error("Preview data contains an invalid event.");
    }
    validateStatements(event.body, 0);
  }
  return model;
}

function validateStatements(statements, depth) {
  if (depth > LIMITS.blockDepth || statements.length > LIMITS.blocks) {
    throw new Error("Preview data contains too many or deeply nested blocks.");
  }
  for (const statement of statements) {
    if (statement.kind === "block") { validateExpression(statement,depth+1);
    } else if (statement.kind === "setLocal") {
      if (!validName(statement.name)) throw new Error("Invalid local assignment.");
      validateExpression(statement.value,depth+1);
    } else if (statement.kind === "setProperty") {
      if (typeof statement.component !== "string" || typeof statement.property !== "string") {
        throw new Error("Preview data contains an invalid property operation.");
      }
      validateExpression(statement.value, depth + 1);
    } else if (statement.kind === "setGlobal") {
      if (!validName(statement.name)) throw new Error("Preview data contains an invalid global assignment.");
      validateExpression(statement.value, depth + 1);
    } else if (statement.kind !== "unsupported" || typeof statement.blockType !== "string") {
      throw new Error("Preview data contains an invalid block operation.");
    }
  }
}

function validateExpression(expression, depth) {
  if (depth > LIMITS.expressionDepth || !expression || typeof expression !== "object") {
    throw new Error("Preview data contains a deeply nested expression.");
  }
  if (expression.kind === "block") {
    if (!WebPreview.EXTENDED_BLOCKS.has(expression.type) || !expression.fields || !expression.mutation || !expression.values || !expression.bodies || !Array.isArray(expression.args) || expression.args.length>100) throw new Error("Invalid extended block.");
    for (const record of [expression.fields,expression.mutation]) {
      if (Object.keys(record).length>30 || Object.values(record).some(v=>typeof v!=="string" || v.length>1000)) throw new Error("Invalid block fields.");
    }
    if (expression.mutation.is_generic === "true" || expression.args.some(n=>!validName(n))) throw new Error("Invalid block arguments.");
    if (Object.keys(expression.values).length>100 || Object.keys(expression.bodies).length>100) throw new Error("Too many block inputs.");
    Object.values(expression.values).forEach(v=>validateExpression(v,depth+1));
    Object.values(expression.bodies).forEach(v=>{if(!Array.isArray(v)) throw new Error("Invalid body.");validateStatements(v,depth+1);});
  } else if (expression.kind === "getLocal") {
    if (!validName(expression.name)) throw new Error("Invalid local variable.");
  } else if (expression.kind === "literal") {
    if (!["string", "number", "boolean"].includes(typeof expression.value) ||
        (typeof expression.value === "number" && !Number.isFinite(expression.value)) ||
        (typeof expression.value === "string" && expression.value.length > 20_000)) {
      throw new Error("Preview data contains an invalid literal.");
    }
  } else if (expression.kind === "getProperty") {
    if (typeof expression.component !== "string" || typeof expression.property !== "string") {
      throw new Error("Preview data contains an invalid property read.");
    }
  } else if (expression.kind === "getGlobal") {
    if (!validName(expression.name)) throw new Error("Preview data contains an invalid global read.");
  } else if (expression.kind === "joinText") {
    if (!Array.isArray(expression.values) || expression.values.length > 100) {
      throw new Error("Preview data contains an invalid text join.");
    }
    expression.values.forEach(value => validateExpression(value, depth + 1));
  } else if (expression.kind !== "unsupported" || typeof expression.blockType !== "string") {
    throw new Error("Preview data contains an invalid expression.");
  }
}

function validName(name) {
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name);
}

Object.assign(WebPreview, { validateRuntimeModel });
})(globalThis.WebPreview ||= {});
