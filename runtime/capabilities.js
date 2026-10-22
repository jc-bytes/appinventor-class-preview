(function (WebPreview) {
const COMPONENTS = new Map([
  ["Form", {
    element: "section",
    properties: new Set(["Title", "Width", "Height", "Visible", "BackgroundColor", "AlignHorizontal",
      "ActionBar", "ScreenOrientation"]),
    events: new Set(),
    defaults: { Title: "", Visible: true }
  }],
  ["Label", {
    element: "div",
    properties: new Set([
      "Text", "Width", "Height", "Visible", "BackgroundColor", "TextColor",
      "FontSize", "FontBold", "FontItalic", "TextAlignment"
    ]),
    events: new Set(),
    defaults: { Text: "", Visible: true, FontSize: 14, FontBold: false, FontItalic: false }
  }],
  ["Button", {
    element: "button",
    properties: new Set([
      "Text", "Width", "Height", "Visible", "Enabled", "BackgroundColor", "TextColor",
      "FontSize", "FontBold", "FontItalic", "TextAlignment", "Shape"
    ]),
    events: new Set(["Click"]),
    defaults: { Text: "Button", Visible: true, Enabled: true, FontSize: 14 }
  }],
  ["TextBox", {
    element: "input",
    properties: new Set([
      "Text", "Width", "Height", "Visible", "Enabled", "BackgroundColor", "TextColor",
      "FontSize", "FontBold", "FontItalic", "TextAlignment", "Hint"
    ]),
    events: new Set(),
    defaults: { Text: "", Hint: "", Visible: true, Enabled: true, FontSize: 14 }
  }],
  ["VerticalArrangement", {
    element: "div",
    properties: new Set(["Width", "Height", "Visible", "BackgroundColor", "AlignHorizontal"]),
    events: new Set(),
    defaults: { Visible: true }
  }],
  ["Spinner", {
    element: "select",
    properties: new Set(["Width", "Height", "Visible", "Enabled", "ElementsFromString", "Selection",
      "BackgroundColor", "FontSize", "FontTypeface", "TextColor"]),
    events: new Set(),
    defaults: { Visible: true, Enabled: true, ElementsFromString: "" }
  }]
]);

const BLOCKS = new Map([
  ["component_event", "event"],
  ["component_set_get", "property"],
  ["text", "text"],
  ["math_number", "number"],
  ["logic_boolean", "boolean"],
  ["global_declaration", "global variable"],
  ["lexical_variable_get", "global variable read"],
  ["lexical_variable_set", "global variable write"],
  ["text_join", "text join"]
]);

const EXTENDED_BLOCKS = new Set([
  "procedures_defnoreturn", "procedures_callnoreturn", "component_method", "component_component_block",
  "lists_create_with", "lists_select_item", "lists_length", "lists_is_list", "lists_add_items",
  "lists_remove_item", "lists_replace_item", "pair", "dictionaries_create_with", "dictionaries_lookup",
  "dictionaries_set_pair", "text_trim", "logic_compare", "logic_operation", "logic_negate",
  "math_compare", "math_add", "math_subtract", "controls_choose", "controls_if", "controls_forEach"
]);
for (const name of EXTENDED_BLOCKS) BLOCKS.set(name, name);
COMPONENTS.get("Form").events = new Set(["Initialize", "ErrorOccurred"]);
for (const p of ["TitleVisible", "Scrollable", "Sizing", "Theme", "PrimaryColor", "PrimaryColorDark", "AccentColor"])
  COMPONENTS.get("Form").properties.add(p);
COMPONENTS.get("TextBox").properties.add("MultiLine");
COMPONENTS.set("PasswordTextBox", {...COMPONENTS.get("TextBox")});
COMPONENTS.set("HorizontalArrangement", {...COMPONENTS.get("VerticalArrangement")});
for (const [type, properties, events, methods, defaults] of [
  ["Web", ["Url", "RequestHeaders", "Timeout", "SaveResponse"], ["GotText", "TimedOut"],
    ["Get", "PostText", "PutText", "JsonObjectEncode", "JsonTextDecodeWithDictionaries"], {Timeout:15000}],
  ["TinyDB", ["Namespace"], [], ["GetValue", "StoreValue"], {Namespace:"TinyDB"}],
  ["Player", ["Source", "Volume", "PlayOnlyInForeground"], [], ["Start", "Stop"], {Volume:100}],
  ["Clock", ["TimerEnabled", "TimerInterval", "TimerAlwaysFires"], ["Timer"], [], {TimerEnabled:false,TimerInterval:1000}]
]) COMPONENTS.set(type, {element:"span", nonVisible:true, properties:new Set(properties),
  events:new Set(events), methods:new Set(methods), defaults});

const LIMITS = Object.freeze({
  sourceCharacters: 500_000,
  components: 200,
  componentDepth: 40,
  blocks: 2_000,
  blockDepth: 100,
  executionSteps: 10_000,
  expressionDepth: 100
});

const COMPONENT_METADATA_PROPERTIES = new Set([
  "$Name", "$Type", "$Version", "$Components", "Uuid"
]);
// BlocksToolkit configures editor drawers and has no runtime behavior.
const FORM_EDITOR_ONLY_PROPERTIES = new Set(["BlocksToolkit"]);
const FORM_BUILD_ONLY_PROPERTIES = new Set(["AppName"]);

Object.assign(WebPreview, { EXTENDED_BLOCKS, COMPONENTS, BLOCKS, LIMITS, COMPONENT_METADATA_PROPERTIES,
  FORM_BUILD_ONLY_PROPERTIES, FORM_EDITOR_ONLY_PROPERTIES });
})(globalThis.WebPreview ||= {});
