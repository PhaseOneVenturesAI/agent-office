import type { CubbiesClientMsg, CubbiesServerMsg } from './protocol/cubbies.js';
import type { DraftsClientMsg, DraftsServerMsg } from './protocol/drafts.js';
export * from './protocol/cubbies.js';
export * from './protocol/drafts.js';
// Wire protocol between browser and server. Every WebSocket frame is one JSON object.
//
// Each part of the office keeps its state types and its messages in ./protocol/<domain>.ts; this
// file puts them back together, so everything is still imported from here, and makes the two
// unions every frame is one of.

import type { DeliveryClientMsg, DeliveryServerMsg } from './protocol/delivery.js';
import type { ConversationClientMsg, ConversationServerMsg } from './protocol/conversations.js';
import type { HandoffClientMsg, HandoffServerMsg } from './protocol/handoffs.js';
import type { ProviderReadinessClientMsg, ProviderReadinessServerMsg } from './protocol/provider-readiness.js';
import type { AccountsClientMsg, AccountsServerMsg, SignInsClientMsg, TeamClientMsg } from './protocol/accounts.js';
import type { ChangesClientMsg, ChangesServerMsg } from './protocol/changes.js';
import type { CostwallClientMsg, CostwallServerMsg } from './protocol/costwall.js';
import type { DeploysClientMsg, DeploysServerMsg } from './protocol/deploys.js';
import type { FloorClientMsg, FloorServerMsg, PlanClientMsg } from './protocol/floors.js';
import type { GitHubClientMsg, GitHubServerMsg } from './protocol/github.js';
import type { HygieneClientMsg, HygieneServerMsg } from './protocol/hygiene.js';
import type { MeetingClientMsg, MeetingServerMsg } from './protocol/meetings.js';
import type { NodesClientMsg, NodesServerMsg } from './protocol/nodes.js';
import type { PresenceClientMsg, PresenceServerMsg } from './protocol/presence.js';
import type { QueueClientMsg, QueueServerMsg } from './protocol/queue.js';
import type { RooftopClientMsg, RooftopServerMsg } from './protocol/rooftop.js';
import type { SettingsClientMsg, SettingsServerMsg } from './protocol/settings.js';
import type { BallClientMsg, CabinetClientMsg, CarClientMsg, DecorClientMsg, DogClientMsg, JukeboxClientMsg, ToysServerMsg, TvClientMsg, WhiteboardClientMsg } from './protocol/toys.js';
import type { UsageClientMsg, UsageServerMsg } from './protocol/usage.js';
import type { WorkerClientMsg, WorkerServerMsg } from './protocol/workers.js';

export * from './protocol/conversations.js';
export * from './protocol/delivery.js';
export * from './protocol/handoffs.js';
export * from './protocol/provider-readiness.js';
export * from './protocol/accounts.js';
export * from './protocol/agents.js';
export * from './protocol/changes.js';
export * from './protocol/costwall.js';
export * from './protocol/deploys.js';
export * from './protocol/floors.js';
export * from './protocol/github.js';
export * from './protocol/hygiene.js';
export * from './protocol/meetings.js';
export * from './protocol/nodes.js';
export * from './protocol/presence.js';
export * from './protocol/queue.js';
export * from './protocol/rooftop.js';
export * from './protocol/settings.js';
export * from './protocol/toys.js';
export * from './protocol/usage.js';
export * from './protocol/workers.js';

export type ClientMsg =
  | CubbiesClientMsg
  | DraftsClientMsg
  | DeliveryClientMsg
  | ConversationClientMsg
  | HandoffClientMsg
  | ProviderReadinessClientMsg
  | PresenceClientMsg
  | RooftopClientMsg
  | WorkerClientMsg
  | GitHubClientMsg
  | QueueClientMsg
  | MeetingClientMsg
  | FloorClientMsg
  | PlanClientMsg
  | ChangesClientMsg
  | CostwallClientMsg
  | DeploysClientMsg
  | TeamClientMsg
  | AccountsClientMsg
  | SignInsClientMsg
  | HygieneClientMsg
  | NodesClientMsg
  | SettingsClientMsg
  | UsageClientMsg
  | DecorClientMsg
  | JukeboxClientMsg
  | TvClientMsg
  | CabinetClientMsg
  | WhiteboardClientMsg
  | BallClientMsg
  | CarClientMsg
  | DogClientMsg;

export type ServerMsg =
  | CubbiesServerMsg
  | DraftsServerMsg
  | DeliveryServerMsg
  | ConversationServerMsg
  | HandoffServerMsg
  | ProviderReadinessServerMsg
  | PresenceServerMsg
  | RooftopServerMsg
  | WorkerServerMsg
  | GitHubServerMsg
  | QueueServerMsg
  | MeetingServerMsg
  | FloorServerMsg
  | ChangesServerMsg
  | CostwallServerMsg
  | DeploysServerMsg
  | AccountsServerMsg
  | HygieneServerMsg
  | NodesServerMsg
  | SettingsServerMsg
  | UsageServerMsg
  | ToysServerMsg;
