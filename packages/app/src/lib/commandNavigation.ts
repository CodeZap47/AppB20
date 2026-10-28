const conversations = new Map<string, string>();
export function rememberCommandConversation(memberId: string, pathname: string) {
  if (/^\/m\/mensajes(?:\/(?:directos|canales)\/[^/]+)?$/.test(pathname)) conversations.set(memberId, pathname);
}
export function commandConversation(memberId: string) { return conversations.get(memberId) ?? '/m/mensajes'; }
