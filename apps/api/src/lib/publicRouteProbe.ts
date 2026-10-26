export type PublicRouteProbe = { reachable: boolean; sameInstance: boolean; message: string | null };

export async function probePublicRoute(
  origin: string,
  bootId: string,
  request: (url: string) => Promise<Response>
): Promise<PublicRouteProbe> {
  const host = new URL(origin).hostname;
  try {
    const response = await request(`${origin.replace(/\/$/, "")}/public/ping`);
    if (!response.ok) return {
      reachable: false, sameInstance: false,
      message: response.status === 502
        ? `${host} returned HTTP 502. Check that its Cloudflare application route targets http://127.0.0.1:4010 on this machine.`
        : `${host} returned HTTP ${response.status} while checking the public connection.`
    };
    const body = await response.json().catch(() => null) as { bootId?: string } | null;
    const sameInstance = body?.bootId === bootId;
    return { reachable: true, sameInstance, message: sameInstance ? null : `${host} responds, but does not identify this Core instance.` };
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    const message = code === "ENOTFOUND" ? `${host} could not be resolved by DNS. Check the saved public hostname and its DNS record.`
      : code === "EAI_AGAIN" ? `DNS lookup for ${host} temporarily failed. Retry the connection.`
      : error?.name === "AbortError" || error?.name === "TimeoutError" ? `The connection to ${host} timed out.`
      : `Could not connect to ${host}. Check the network, certificate, and Cloudflare route.`;
    return { reachable: false, sameInstance: false, message };
  }
}
