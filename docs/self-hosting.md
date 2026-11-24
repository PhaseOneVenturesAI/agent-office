# Run it on a server for your team

Any Ubuntu or Debian server, with one line, or set up by hand behind Caddy or nginx. Back to the [README](../README.md).

Run this on any Ubuntu or Debian server, as root or as a user with sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash
```

Or run it from your computer without logging in first: `ssh root@203.0.113.7 'curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash'`.

It takes a few minutes the first time:

1. Installs Node.js 22, git, the GitHub CLI and **Claude Code**. Run as root, it creates an `agentoffice` user and runs the office as that user, so workers never run as root.
2. Clones agent-office into `/opt/agent-office` and runs it under systemd. `Restart=always` brings it back after a crash or a reboot, and `KillMode=process` keeps workers running through a restart. It listens on `127.0.0.1:4600` only. The office keeps its data in `~/agent-office` and clones projects into `~/workspace/<owner>/<repo>`.
3. Sets up **👥 Invite teammates**. Teammates' SSH keys log in as a separate `office` user that can only forward to the office port: no shell, no other ports.
4. Offers to sign the GitHub CLI in, if it's running in a terminal.
5. Prints how to get in:

```
  On your computer, open a tunnel and leave it running:

    ssh -N -L 4600:localhost:4600 root@203.0.113.7

  then open http://localhost:4600/claim?t=…
  It shows the office password once: write it down.
```

Everything goes through SSH, so there are no certificates to manage, and `localhost` counts as a secure origin, so voice and screen sharing work. Claude signs in from the office: the first worker asks you to type `/login` in its terminal. If GitHub isn't signed in yet, run `gh auth login` from a shell at any desk (**B**). Do both while you're in on the office password: those are the machine's own sign-ins. Teammates you give [accounts](../README.md#add-users) sign in to their own Claude and GitHub in **☰ → 🔐 Your sign-ins**, and their workers run on their own plan. To update, run the same line again, or use **⬆️ Upgrade the office** in the **☰** menu. Options go after `bash -s --`: `--project owner/repo` clones a first floor, and `--help` lists the rest.

**On your own domain.** Point a DNS record at the server, open ports 80 and 443, and add `--domain`:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash -s -- --domain office.example.com
```

It installs [Caddy](https://caddyserver.com), which gets a certificate from Let's Encrypt by itself and serves the office on https://office.example.com. The claim link is then `https://office.example.com/claim?t=…`. Give teammates an invite link each from **🔑 Accounts**.

**On your Tailscale network.** No domain, and no ports to open: add `--tailscale`, and the server joins your tailnet and serves the office on `https://agent-office.<your-tailnet>.ts.net` with [Tailscale Serve](https://tailscale.com/kb/1312/serve), which brings its own certificate:

```bash
curl -fsSL https://raw.githubusercontent.com/AgentSystemLabs/agent-office/main/deploy/provision.sh | bash -s -- --tailscale
```

It prints a link to add the machine to your tailnet (or pass `--tailscale-auth-key tskey-auth-…`), and the first time, one that turns on MagicDNS and HTTPS Certificates for the tailnet. It waits for each. `--tailscale-hostname` names the machine (`agent-office` by default). Then anyone on your tailnet opens the link, and workers' web servers get links of their own, `https://agent-office.<your-tailnet>.ts.net:<port>`, still behind the office sign-in. For someone outside your tailnet, share the machine with them from Tailscale's Machines page. Re-running the script keeps it on the tailnet. Turn off key expiry for the machine on that page, or it drops off after 180 days. The details, and what else the tailnet can reach on the machine, are in the [AWS reference](aws.md#tailscale), since `deploy/aws.sh up --tailscale` does the same thing.

**Setting it up by hand** (another distribution, or your own proxy): run `agent-office`, which listens on `127.0.0.1` only, and reach it through `ssh -L 4600:localhost:4600 you@server`. Or put it behind HTTPS on a domain, which voice and screen sharing need, with Caddy:

```caddy
# /etc/caddy/Caddyfile
office.example.com {
    reverse_proxy 127.0.0.1:4600
}
```

```bash
agent-office setup --projects ~/workspace --project owner/repo   # once; or pick projects in the office
agent-office --host 127.0.0.1 --trust-proxy --password "$(openssl rand -base64 18)"
```

Caddy proxies WebSockets out of the box. With nginx, forward the Host and Upgrade headers:

```nginx
location / {
    proxy_pass http://127.0.0.1:4600;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1d;
}
```

To keep the office running, use a systemd unit:

```ini
# /etc/systemd/system/agent-office.service
[Unit]
Description=Agent Office
After=network.target

[Service]
User=dev
WorkingDirectory=/home/dev
# generate with: openssl rand -base64 24
Environment=AGENT_OFFICE_PASSWORD=<a long random password>
ExecStart=/usr/bin/env agent-office --host 127.0.0.1 --trust-proxy
Restart=on-failure
# Restarting the office leaves the workers' terminals running for the next one to pick up.
KillMode=process

[Install]
WantedBy=multi-user.target
```

If you don't have a domain, `--self-signed` serves HTTPS directly. Browsers will warn once per person.

### Voice across strict NATs

Peers try direct connections using STUN. A TURN relay provides a fallback across restrictive NATs; it does not fix microphone permission, muted devices or blocked audio playback. A failed call displays a toast.

Existing `--turn turn:user:pass@turn.example.com:3478` and `AGENT_OFFICE_TURN` (space-separated URLs) remain supported. These static credentials are distributed to signed-in browsers, so prefer expiring credentials for a shared office:

```sh
AGENT_OFFICE_TURN_URLS="turn:turn.example.com:3478?transport=udp turns:turn.example.com:5349?transport=tcp"
AGENT_OFFICE_TURN_SECRET="<at least 32 random characters; server-only>"
AGENT_OFFICE_TURN_TTL=3600
```

Configure coturn with the same server-only `static-auth-secret`, `use-auth-secret`, a realm, authenticated allocations, TLS certificate, restricted relay ports, quotas and private/link-local peer address restrictions. Never put the signing secret in `AGENT_OFFICE_TURN`, a browser bundle, or Git. Store it in a restricted service environment file. Worker/shell environments strip these `AGENT_OFFICE_` settings. This is environment isolation, not an OS sandbox against shell access to host files.

The office issues timestamp/HMAC credentials only to a still-authenticated 3D office session asking to establish or maintain voice peers, including receive-only listeners. Named accounts are rechecked on renewal; shared-password access must still be enabled. TTL is 600–86400 seconds (default one hour). Derived credentials remain usable until expiration even after sign-out; revoking an Office account prevents fresh issuance, not immediate relay termination.

Clients refresh two minutes before expiry, update peer configurations, and restart ICE for relay-selected calls (or failed connections); healthy direct calls are not restarted. Requests are deduplicated, time out after three seconds, and stop after three unanswered attempts until reconnection or a new voice-peer lifecycle. No refresh timer runs after disconnect or after the last peer leaves. Expired cached credentials are not used to create new connections. Static ICE fallback still works if a server does not support expiring credentials. Browser microphone consent remains unchanged.

Use a directly reachable relay hostname. The ordinary HTTP Cloudflare tunnel used for the office is not a browser TURN relay. Allow only configured TURN listener and UDP relay ports in host/provider firewalls; do not expose the Office's localhost port. A TLS listener on 5349 may still fail on networks restricted to 443. Decide 443 ownership before changing an existing HTTPS service.

Before calling the relay verified, force `iceTransportPolicy: 'relay'` in a controlled test with synthetic audio on two independent networks. Check the selected ICE pair and bidirectional received bytes/audio energy for UDP, TCP and TLS, plus long-call renewal, invalid/expired credential rejection and private-address denial. A two-tab direct call proves neither cross-network routing nor TURN operation. Installing this app support alone does not provision a relay.
