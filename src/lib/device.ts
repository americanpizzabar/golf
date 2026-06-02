// Anonymous, login-free identity: a stable id stored in localStorage.
const KEY = "golf_device_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      "dev_" +
      (crypto.randomUUID?.() ??
        Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem(KEY, id);
  }
  return id;
}
