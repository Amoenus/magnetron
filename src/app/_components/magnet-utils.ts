export function magnetDisplayName(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "magnet:") {
      return "";
    }
    return url.searchParams.get("dn")?.trim() ?? "";
  } catch {
    return "";
  }
}
