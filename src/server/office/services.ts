import path from 'node:path';
import { HQMac } from '../hq/mac.js';
import { HQ } from '../hq/index.js';
import { Drafts } from '../drafts/index.js';
import { Cubbies } from '../cubbies/index.js';
import { cubbiesChanged } from '../ws/handlers/cubbies.js';
import os from 'node:os';
import { childEnv, resolveCommand } from '../workers.js';
import { SignIns } from '../signins.js';
import { Deploys } from '../deploys.js';
import { Hygiene } from '../hygiene.js';
import { Costwall } from '../costwall.js';
import { Deliveries } from '../delivery/index.js';
import { Nodes } from '../nodes.js';
import { CloudflareAccess } from '../cloudflare.js';
import { agentProviders, configuredProvider } from '../agents.js';
import { Tailnet } from '../tailnet.js';
import { Team } from '../team.js';
import { Upgrader } from '../upgrade.js';
import { Services } from '../services.js';
import { ImageProxy } from '../decor.js';
import { Ledger } from '../usage.js';
import { LimitsHub } from '../limits/index.js';
import { LIMITS_PROVIDERS } from '../../shared/protocol.js';
import { Webhook } from '../webhook.js';
import { Machine } from '../machine.js';
import type { Floor } from '../floor.js';
import { Sky } from '../sky.js';
import { Themes } from '../theme.js';
import { Maps } from '../maps.js';
import { OfficePrompts } from '../prompts.js';
import { LeaveOnMerge } from '../leave-on-merge.js';
import type { ServiceInfo, ServicesState } from '../../shared/protocol.js';
import type { BuildingServices, Ctx, LateServices } from './context.js';
import type { Client } from './client.js';

/** What the whole building shares, made before any floor opens: the sky, ⚙️ Settings, spend, sign-ins, limits. */
export function createServices(ctx: Ctx): BuildingServices {
  const { cfg, accounts, clients, floors } = ctx;
  // Day, night and the weather outside the windows, the same for everyone.
  const sky = new Sky({ city: cfg.city, weather: cfg.weather, realTime: cfg.realTimeSky, placeFile: path.join(cfg.dataDir, 'sky-place.json'), clockFile: path.join(cfg.dataDir, 'sky-clock.json') }, (state) => ctx.broadcast({ t: 'sky', state }));
  sky.start();
  // Halloween or Christmas all over the building, the same for everyone (⚙️ Settings). On 'auto' it
  // goes by the calendar at the office, the sky's clock.
  const themes = new Themes(cfg.dataDir, () => sky.state.utcOffset, (state) => ctx.broadcast({ t: 'theme', state }));
  themes.start();
  // What the building looks like inside: the office, the castle, or a map of your own (⚙️ Settings).
  const maps = new Maps(cfg.dataDir);
  // The prompts the office writes for workers by itself, and the worker everyone starts on (⚙️ Settings).
  const configured = configuredProvider(cfg.agentCmd);
  const prompts = new OfficePrompts(cfg.dataDir, { list: agentProviders(configured), configured }, (state) => ctx.broadcast({ t: 'prompts', state }));
  // Whether a worker whose pull request merged goes home by itself, on every floor (⚙️ Settings).
  const leaveOnMerge = new LeaveOnMerge(cfg.dataDir, (state) => ctx.broadcast({ t: 'leaveOnMerge', state }));

  // What the workers spend, all time and today, with the optional daily budget.
  const ledger = new Ledger(
    cfg.dataDir,
    { budget: cfg.budget, pauseHiring: cfg.budgetPause },
    (state) => ctx.broadcast({ t: 'usage', state }),
    ctx.toastAll,
  );

  const claudeBin = configuredProvider(cfg.agentCmd) === 'claude' ? resolveCommand(cfg.agentCmd) : resolveCommand('claude');
  const codexBin = resolveCommand('codex');
  // Everyone with an account runs on their own Claude, Kimi, Codex and GitHub sign-ins (see signins.ts).
  // On the shared password, with no accounts, the office's own are used, as they always were.
  const signins = new SignIns(
    cfg.dataDir,
    claudeBin,
    resolveCommand('kimi'),
    codexBin,
    resolveCommand('gh'),
    childEnv,
    (id) => accounts.get(id)?.role === 'admin',
    (id) => {
      for (const c of clients.values()) if (c.accountId === id && !c.out) ctx.sendTo(c, { t: 'signins', state: signins.state(id) });
    },
  );
  // Accounts revoked from the terminal while the office was closed leave their sign-ins behind.
  if (!accounts.unreadableFile) signins.prune(new Set(accounts.state(new Set()).accounts.map((a) => a.id)));

  // The Deploy board: the office's Cloudflare Pages and Workers projects (☰ → 🚀 Deploy board),
  // Without credentials the board
  // explains how to connect them; the token never leaves the server (see deploys.ts).
  const deploys = new Deploys(cfg.cfDeploys, () => ctx.broadcast({ t: 'deploys', state: deploys.state() }));

  // The hygiene watchdog: every six hours it scans every floor for unpushed commits, worktrees
  // no worker uses and merged workers who never went home (☰ → 🧹 Hygiene), so the mess we
  // cleaned by hand once doesn't quietly regrow.
  const hygiene = new Hygiene(() => [...floors.values()].filter(f => !f.def.draft), () => ctx.broadcast({ t: 'hygiene', state: hygiene.state() }));

  // The cost wall: every agent's session usage added up per person and per provider (☰ → 💸
  // Cost wall), next to the office ledger's all-time and today. It recomputes from the workers
  // at their desks, so it's never stale; a slow timer broadcasts it when the numbers moved.
  const costwall = new Costwall(() => [...floors.values()], ledger, () => ctx.broadcast({ t: 'costwall', state: costwall.state() }));

  // The satellites: the team's own computers, joined with `agent-office join` (☰ → 🛰️
  // Satellites). The office keeps only each join token's hash; the wall follows the hellos
  // and heartbeats. Each browser gets its own wall: a private machine shows only for the
  // account that invited it and for admins.
  const deliveries = new Deliveries();
  let cubbies: Cubbies | undefined;
  const nodes = new Nodes(cfg.dataDir, () => {
    for (const c of clients.values()) ctx.sendTo(c, { t: 'nodes', state: nodes.state({ id: c.accountId, admin: ctx.meOf(c.accountId).admin }) });
    cubbies?.refresh();
    hq?.mac?.refresh();
    cubbiesChanged(ctx);
  });
  const hq = new HQ(cfg.dataDir, process.env.AGENT_OFFICE_HQ_OWNER, process.env.AGENT_OFFICE_HQ_MANAGERS, id => accounts.get(id), ctx.building, email => accounts.byEmail(email));
  const drafts = new Drafts(cfg.dataDir, process.env.AGENT_OFFICE_CUBBIES === '1', process.env.AGENT_OFFICE_PROJECT_STARTERS, id => accounts.get(id)?.name, ctx.building);
  cubbies = new Cubbies(cfg.dataDir, process.env.AGENT_OFFICE_CUBBIES === '1', nodes, id => accounts.get(id)?.name, id => floors.has(id), () => cubbiesChanged(ctx), Date.now, id => ctx.building.list().find(d => d.id === id)?.draft ? drafts.records.rows.get(id)?.owner ?? '' : undefined);

  hq.mac = new HQMac(cfg.dataDir, hq, nodes, () => cubbiesChanged(ctx));

  // Behind Cloudflare Access, its edge login is the front door (see cloudflare.ts): no office
  // password is needed, and each verified email gets an account of its own.
  const cloudflare = cfg.cfAccess ? new CloudflareAccess(cfg.cfAccess.team, cfg.cfAccess.aud, new Set(cfg.cfAccess.admins)) : undefined;

  // The plan limits of every provider that can report them (Claude's 5-hour session and week,
  // Codex's, Kimi's), for the meter under the workers: the office's own plans, and each account's
  // own once it runs on sign-ins of its own.
  const limits = new LimitsHub({
    claude: claudeBin,
    codex: codexBin,
    envFor: () => childEnv(),
    wanted: () => [...clients.values()].some((c) => limitsOf(c) === limits),
    onChange: (state) => {
      for (const c of clients.values()) if (limitsOf(c) === limits) ctx.sendTo(c, { t: 'limits', state });
    },
  });
  const accountLimits = new Map<string, { key: string; hub: LimitsHub }>();
  /** Whose plans `c` sees: their own, on an account with sign-ins of its own; else the office's. */
  const limitsOf = (c: Client): LimitsHub => {
    const id = c.accountId;
    if (!id) return limits;
    const key = LIMITS_PROVIDERS.map((k) => signins.planKey(id, k) ?? '-').join('|');
    let a = accountLimits.get(id);
    if (a?.key !== key) {
      a?.hub.close();
      const hub = new LimitsHub({
        claude: claudeBin,
        codex: codexBin,
        envFor: (kind) => signins.apply(id, childEnv(), [], kind),
        wanted: () => [...clients.values()].some((o) => o.accountId === id),
        onChange: (state) => {
          for (const o of clients.values()) if (o.accountId === id) ctx.sendTo(o, { t: 'limits', state });
        },
      });
      a = { key, hub };
      accountLimits.set(id, a);
    }
    return a.hub;
  };

  // Slack / Discord pings for workers that need input or finish (set from ⚙️ Settings or --webhook).
  const webhook = new Webhook(cfg.dataDir, (workerId) => (workerId && ctx.workerFloor(workerId)?.def.name) || ctx.officeName, (state) => ctx.broadcast({ t: 'notify', state }));
  if (cfg.webhook !== undefined) {
    const err = webhook.set(cfg.webhook, 'the command line');
    if (err) console.error(`agent-office: --webhook: ${err}`);
  }

  // The machine's CPU and memory, for the monitor on the wall and a warning before hiring, and the
  // most workers the office runs at once, across every floor (--max-workers, or ⚙️ Settings).
  const machine = new Machine(
    cfg.dataDir,
    cfg.maxWorkers,
    () => {
      let n = 0;
      for (const f of floors.values()) n += f.workers.list().length;
      return n;
    },
    (state) => ctx.broadcast({ t: 'machine', state }),
  );
  machine.start();
  /** Queues everywhere may be waiting for room under the worker limit: let them look again. */
  const pumpQueues = (except?: Floor) => {
    if (machine.limit === undefined) return;
    // Not right now: whoever freed the seat (a queue making room for its next task) takes it first.
    setImmediate(() => {
      for (const f of floors.values()) if (f !== except) f.queue.pump();
    });
  };

  return { sky, themes, maps, prompts, leaveOnMerge, ledger, signins, deploys, hygiene, costwall, nodes, cubbies, drafts, hq, deliveries, cloudflare, limits, accountLimits, webhook, machine, limitsOf, pumpQueues };
}

/** What's made once the floors are open: the SSH team, the tailnet, workers' web servers, pictures and upgrades. */
export function createLateServices(ctx: Ctx): LateServices {
  const { cfg, clients, floors } = ctx;
  const team = new Team(cfg.publicHost, cfg.port, cfg.tailnet);
  const tailnet = new Tailnet(cfg.tailnet);

  // Web servers the workers start, for the Services board and service tunnels (see relay.ts).
  // One scan covers every floor; each floor's board lists its own workers' servers.
  const servicesState = (floor: Floor | undefined, items: ServiceInfo[] = services.list()): ServicesState => ({
    items: floor ? items.filter((s) => floor.workers.get(s.workerId)) : [],
    port: cfg.port,
    deploy: cfg.deployScript,
    ssh: team.ssh,
    tailnet: cfg.tailnet,
  });
  const services = new Services(
    () => [...floors.values()].flatMap((f) => f.workers.owners()),
    (items) => {
      for (const c of clients.values()) ctx.sendTo(c, { t: 'services', state: servicesState(ctx.floorOf(c), items) });
      tailnet.sync(items.map((s) => s.port));
    },
  );

  const images = new ImageProxy();

  const upgrader = new Upgrader(
    (state) => ctx.broadcast({ t: 'upgrade', state }),
    () => {
      // cli.ts shuts down gracefully, leaving the workers running in their terminal host; systemd
      // (Restart=always) then starts the new version, which picks them back up.
      process.kill(process.pid, 'SIGTERM');
    },
  );
  return { team, tailnet, services, images, upgrader, servicesState };
}
