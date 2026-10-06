#include <mach-o/dyld.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Resolve relative to this executable, never the working directory or argv[0]. */
int main(int argc, char **argv) {
  char executable[PATH_MAX], resolved[PATH_MAX], script[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, resolved)) {
    perror("Certifyd Core: cannot locate launcher");
    return 1;
  }
  char *slash = strrchr(resolved, '/');
  if (!slash) return 1;
  *slash = '\0';
  int length = snprintf(script, sizeof(script), "%s/../Resources/CertifydCoreLauncher.sh", resolved);
  if (length < 0 || (size_t)length >= sizeof(script) || access(script, R_OK) != 0) {
    fputs("Certifyd Core: startup script missing or path too long\n", stderr);
    return 1;
  }
  char **args = calloc((size_t)argc + 4, sizeof(char *));
  if (!args) return 1;
  args[0] = "/bin/bash";
  args[1] = "--noprofile";
  args[2] = "--norc";
  args[3] = script;
  for (int i = 1; i < argc; i++) args[i + 3] = argv[i];
  unsetenv("BASH_ENV");
  unsetenv("ENV");
  execv(args[0], args);
  perror("Certifyd Core: cannot start bash");
  free(args);
  return 1;
}
