import type {
  ApiReferenceItem,
  CodePayload,
  ControlPayload,
  GameSnapshot,
  SettingsPayload
} from "../../../shared/types";

export async function getSnapshot(): Promise<GameSnapshot> {
  return request<GameSnapshot>("/api/state");
}

export async function getCode(): Promise<CodePayload> {
  return request<CodePayload>("/api/code");
}

export async function getReference(): Promise<ApiReferenceItem[]> {
  return request<ApiReferenceItem[]>("/api/reference");
}

export async function saveCode(code: string): Promise<CodePayload> {
  return request<CodePayload>("/api/code", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code })
  });
}

export async function sendControl(command: ControlPayload["command"]): Promise<GameSnapshot> {
  return request<GameSnapshot>("/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command })
  });
}

export async function saveSettings(settings: SettingsPayload): Promise<GameSnapshot> {
  return request<GameSnapshot>("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }
  return payload;
}
