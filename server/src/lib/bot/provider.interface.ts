export interface BotLaunchParams {
  meetingId: string
  meetUrl: string
  botName?: string
  webhookCallbackUrl?: string
}

export interface BotLaunchResult {
  externalBotId: string
  status: string
  message?: string
}

export interface IMeetingBotProvider {
  launchBot(params: BotLaunchParams): Promise<BotLaunchResult>
  leaveBot(externalBotId: string): Promise<boolean>
  getBotStatus(externalBotId: string): Promise<{ status: string; active: boolean }>
}
