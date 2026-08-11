const SUPPORTED_KINDS = new Set(["unit", "spawn", "source", "controller"]);

export function createPresentationAdapter() {
  return Object.freeze({
    id: "dev.nexora.example.automation-colony.presentation.web",
    version: "0.1.0",
    supports(object) {
      return object != null && SUPPORTED_KINDS.has(object.kind);
    },
    key(object) {
      return String(object.id);
    },
    position(object) {
      return { x: Number(object.x), y: Number(object.y) };
    }
  });
}
