export const LUCKIN_WECHAT_TOKEN_BIND_COMMAND = "绑定瑞幸 token Authorization: Bearer <你的瑞幸 MCP token>";

export function missingLuckinTokenMessage(sourceLabel: string): string {
  return `${sourceLabel} 缺少瑞幸 MCP token；请在微信私聊发送“${LUCKIN_WECHAT_TOKEN_BIND_COMMAND}”，或运行 npm run luckin:official-login 写入本机 token。不要把 token 发到群聊。`;
}

export function expiredLuckinTokenMessage(sourceLabel: string): string {
  return `${sourceLabel}：登录态失效或 token 无效；请在微信私聊重新发送“${LUCKIN_WECHAT_TOKEN_BIND_COMMAND}”，或重新运行 npm run luckin:official-login。`;
}
