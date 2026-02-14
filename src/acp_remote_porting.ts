// Minimal skeleton for ACP remote porting integration into SpeakMCP
export interface PortSettings { enable: boolean; maxRetries?: number; timeoutMs?: number }
export function portAcpRemote(settings: PortSettings){
  // This is a placeholder for porting work; actual integration will flesh out.
  return { status: "stub", settings };
}
