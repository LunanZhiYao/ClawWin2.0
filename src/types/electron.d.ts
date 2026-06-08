export interface WidgetAPI {
  show: () => Promise<void>
  hide: () => Promise<void>
  toggle: () => Promise<void>
  isVisible: () => Promise<boolean>
  sendMessage: (message: string) => Promise<void>
  taskComplete: (success: boolean, message: string) => Promise<void>
  close: () => Promise<void>
  openMainWindow: () => Promise<void>
  setIgnoreMouseEvents: (ignore: boolean) => void
  moveBy: (dx: number, dy: number) => void
  setWaitingState: (isWaiting: boolean, isStreaming: boolean) => Promise<void>
  onMessageReceived: (callback: (message: string) => void) => () => void
  onTaskComplete: (callback: (result: { success: boolean; message: string }) => void) => () => void
  onPositionChanged: (callback: (data: { x: number; y: number; isNearEdge: boolean; edges: string[] }) => void) => () => void
  onWaitingStateChanged: (callback: (data: { isWaiting: boolean; isStreaming: boolean }) => void) => () => void
}

export interface ElectronAPI {
  gateway: any
  setup: any
  shell: any
  app: any
  auth: any
  config: any
  workspace: any
  sessions: any
  dialog: any
  file: any
  skills: any
  pairing: any
  ollama: any
  agents: any
  cww: any
  windowControls: any
  widget: WidgetAPI
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
