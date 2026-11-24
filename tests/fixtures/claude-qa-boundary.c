/* Qualification only: never included in the production image. */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
static int readable(const char *p) { int f=open(p,O_RDONLY);if(f<0)return 0;close(f);return 1; }
static int reachable(const char *ip,int port) { int f=socket(AF_INET,SOCK_STREAM,0);struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons((unsigned short)port)};inet_pton(AF_INET,ip,&a.sin_addr);int ok=connect(f,(struct sockaddr*)&a,sizeof(a))==0;close(f);return ok; }
int main(int argc,char **argv) {
 if(argc!=5)return 64;
 char proc[96];snprintf(proc,sizeof(proc),"/proc/%s/environ",argv[1]);
 int prior=readable("/work/job-canary");int f=open("/work/job-canary",O_CREAT|O_WRONLY,0600);if(f<0||write(f,"OWN_JOB",7)!=7)return 70;close(f);
 int rootwrite=open("/etc/escape",O_CREAT|O_WRONLY,0600);if(rootwrite>=0)close(rootwrite);
 int local=reachable("127.0.0.1",atoi(argv[2])),external=reachable("198.51.100.1",443);
 pid_t child=0;if(argv[4][0]=='1'){child=fork();if(child==0){for(;;)pause();}}
 printf("{\"pid\":%d,\"uid\":%d,\"child\":%d,\"otherProcessReadable\":%s,\"hostCanaryReadable\":%s,\"hostNetworkReachable\":%s,\"externalNetworkReachable\":%s,\"rootWritable\":%s,\"priorJobVisible\":%s,\"shellPresent\":%s}\n",getpid(),getuid(),child,readable(proc)?"true":"false",readable(argv[3])?"true":"false",local?"true":"false",external?"true":"false",rootwrite>=0?"true":"false",prior?"true":"false",access("/bin/sh",F_OK)==0?"true":"false");
 fflush(stdout);if(child>0)for(;;)pause();return 0;
}
