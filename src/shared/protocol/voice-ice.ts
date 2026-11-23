type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string };
export type VoiceIceClientMsg = { t: 'voice.ice'; requestId: string };
export type VoiceIceServerMsg = { t: 'voice.ice'; requestId: string; ice: RTCIceServerLike[]; expiresAt?: number; error?: string };
