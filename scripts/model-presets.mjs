export const MODEL_PRESETS = {
  "claude-opus-4": "anthropic/claude-opus-4",
  "claude-opus-4.0": "anthropic/claude-opus-4",
  opus4: "anthropic/claude-opus-4",
  "opus4.0": "anthropic/claude-opus-4",
  "claude-opus-4.1": "anthropic/claude-opus-4.1",
  "opus4.1": "anthropic/claude-opus-4.1",
  "claude-3-opus": "anthropic/claude-3-opus",
  opus3: "anthropic/claude-3-opus",
  "claude-3-sonnet": "anthropic/claude-3-sonnet",
  sonnet3: "anthropic/claude-3-sonnet",
  "claude-haiku-4.5": "anthropic/claude-haiku-4.5",
  "haiku4.5": "anthropic/claude-haiku-4.5",
  haiku: "anthropic/claude-haiku-4.5",
  "claude-3-haiku": "anthropic/claude-3-haiku",
  haiku3: "anthropic/claude-3-haiku",
  "claude-2.1": "anthropic/claude-2.1",
  claude21: "anthropic/claude-2.1",
  "claude-2": "anthropic/claude-2",
  claude2: "anthropic/claude-2",
};

export function resolveModel(modelOrPreset) {
  return MODEL_PRESETS[modelOrPreset] || modelOrPreset;
}

export function formatModelPresets() {
  const rows = Object.entries(MODEL_PRESETS)
    .map(([alias, model]) => `  ${alias.padEnd(18)} ${model}`)
    .join("\n");
  return `Available local model presets:\n${rows}`;
}
