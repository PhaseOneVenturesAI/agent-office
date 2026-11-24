/* Fixed Claude entry point + loopback-to-Unix byte bridge. No shell or arbitrary argv. */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile sig_atomic_t stopped = 0;
static void stop(int n) { (void)n; stopped = 1; }
static int write_all(int fd, const char *data, size_t size) {
  while (size) { ssize_t n = write(fd, data, size); if (n <= 0) return -1; data += n; size -= (size_t)n; }
  return 0;
}
static int seed(const char *source, const char *target) {
  int in = open(source, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  int out = open(target, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (in < 0 || out < 0) return -1;
  char buffer[16384]; ssize_t n = read(in, buffer, sizeof(buffer));
  if (n <= 0 || n == (ssize_t)sizeof(buffer) || write_all(out, buffer, (size_t)n)) return -1;
  close(in); close(out); return 0;
}
static void bridge(int client) {
  int upstream = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  struct sockaddr_un addr = { .sun_family = AF_UNIX };
  strcpy(addr.sun_path, "/broker.sock");
  if (upstream < 0 || connect(upstream, (struct sockaddr *)&addr, sizeof(addr))) _exit(71);
  struct pollfd fds[] = {{client, POLLIN, 0}, {upstream, POLLIN, 0}};
  char buffer[16384];
  for (;;) {
    if (poll(fds, 2, 125000) <= 0) break;
    for (int i = 0; i < 2; i++) {
      if (fds[i].revents & (POLLIN | POLLHUP | POLLERR)) {
        ssize_t n = read(fds[i].fd, buffer, sizeof(buffer));
        if (n <= 0 || write_all(fds[1-i].fd, buffer, (size_t)n)) _exit(0);
      }
    }
  }
  _exit(0);
}
int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1 || geteuid() == 0) return 64;
  if (access("/etc/claude-code/managed-settings.json", R_OK) || access("/qa-ca.pem", R_OK)) return 78;
  const char *cap = getenv("QA_CAPABILITY");
  if (!cap || strlen(cap) != 64 || strspn(cap, "0123456789abcdef") != 64) return 64;
  if (clearenv()) return 70;
  umask(077);
  if (mkdir("/work/home", 0700) && errno != EEXIST) return 70;
  if (seed("/qa-auth.json", "/work/home/.credentials.json") || seed("/qa-account.json", "/work/home/.claude.json")) return 78;
  setenv("HOME", "/work/home", 1); setenv("CLAUDE_CONFIG_DIR", "/work/home", 1);
  setenv("USER", "qa", 1); setenv("LOGNAME", "qa", 1); setenv("LANG", "C.UTF-8", 1);
  setenv("PATH", "/nonexistent", 1); setenv("TERM", "dumb", 1); setenv("CI", "1", 1);
  /* Auth discovery uses only the generated access-only surrogate and selected team metadata.
     An environment token alone can make the native policy loader ineligible. */
  setenv("HTTPS_PROXY", "http://127.0.0.1:18765", 1);
  setenv("NODE_EXTRA_CA_CERTS", "/qa-ca.pem", 1);
  setenv("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1", 1);
  setenv("CLAUDE_CODE_MAX_OUTPUT_TOKENS", "4096", 1);
  int listener = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  struct sockaddr_in addr = {.sin_family = AF_INET, .sin_port = htons(18765), .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
  if (listener < 0 || bind(listener, (struct sockaddr *)&addr, sizeof(addr)) || listen(listener, 4)) return 71;
  signal(SIGTERM, stop); signal(SIGINT, stop); signal(SIGPIPE, SIG_IGN);
  pid_t cli = fork();
  if (cli < 0) return 71;
  if (!cli) {
    close(listener);
    char *args[] = {"/opt/claude/claude", "--safe-mode", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--disallowedTools", "*", "--no-session-persistence", "--debug-file", "/work/home/native-policy.log", "--output-format", "json", "--model", "claude-sonnet-4-6", "-p", NULL};
    execv(args[0], args); _exit(127);
  }
  pid_t children[8] = {0}; int status = 0, finished = 0;
  while (!stopped) {
    pid_t done = waitpid(cli, &status, WNOHANG);
    if (done == cli) { finished = 1; break; }
    for (int i = 0; i < 8; i++) if (children[i] && waitpid(children[i], NULL, WNOHANG) == children[i]) children[i] = 0;
    struct pollfd p = {listener, POLLIN, 0};
    if (poll(&p, 1, 100) <= 0) continue;
    int client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
    if (client < 0) continue;
    int slot = 0; while (slot < 8 && children[slot]) slot++;
    if (slot == 8) { close(client); continue; }
    pid_t child = fork();
    if (!child) { close(listener); close(STDIN_FILENO); bridge(client); }
    if (child > 0) children[slot] = child;
    close(client);
  }
  close(listener);
  if (!finished) kill(cli, SIGTERM);
  for (int i = 0; i < 8; i++) if (children[i]) kill(children[i], SIGTERM);
  return finished && WIFEXITED(status) ? WEXITSTATUS(status) : 124;
}
