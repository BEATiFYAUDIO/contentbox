export function validateUploadRequest(input: { isMultipart: boolean; hasFile: boolean }): {
  ok: boolean;
  status: number;
  error: string;
} {
  if (!input?.isMultipart) {
    return { ok: false, status: 415, error: "multipart/form-data required" };
  }
  if (!input?.hasFile) {
    return { ok: false, status: 400, error: "file is required" };
  }
  return { ok: true, status: 200, error: "" };
}
