#import <Cocoa/Cocoa.h>
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

@interface CertifydLauncherDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSTextField *statusLabel;
@property(nonatomic, strong) NSProgressIndicator *progress;
@property(nonatomic, strong) NSButton *retryButton;
@property(nonatomic, strong) NSButton *logsButton;
@property(nonatomic, strong) NSTask *task;
@property(nonatomic, strong) NSTimer *statusTimer;
@property(nonatomic, copy) NSString *scriptPath;
@property(nonatomic, copy) NSString *statusPath;
@property(nonatomic, copy) NSArray<NSString *> *forwardedArguments;
@end

@implementation CertifydLauncherDelegate

- (void)setStatus:(NSString *)message error:(BOOL)isError {
  self.statusLabel.stringValue = message.length ? message : @"Preparing the local dashboard…";
  self.statusLabel.textColor = isError
    ? [NSColor colorWithRed:1.0 green:0.58 blue:0.58 alpha:1.0]
    : [NSColor colorWithRed:0.76 green:0.84 blue:0.89 alpha:1.0];
}

- (void)pollStatus:(NSTimer *)timer {
  (void)timer;
  NSString *message = [NSString stringWithContentsOfFile:self.statusPath encoding:NSUTF8StringEncoding error:nil];
  message = [message stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (message.length) [self setStatus:message error:NO];
}

- (void)launchCore {
  self.retryButton.hidden = YES;
  self.logsButton.hidden = YES;
  self.progress.hidden = NO;
  [self.progress startAnimation:nil];
  [self setStatus:@"Checking the local runtime…" error:NO];
  [@"" writeToFile:self.statusPath atomically:YES encoding:NSUTF8StringEncoding error:nil];

  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
  NSMutableArray<NSString *> *arguments = [NSMutableArray arrayWithArray:@[@"--noprofile", @"--norc", self.scriptPath]];
  [arguments addObjectsFromArray:self.forwardedArguments ?: @[]];
  task.arguments = arguments;
  NSMutableDictionary<NSString *, NSString *> *environment = [NSMutableDictionary dictionaryWithDictionary:NSProcessInfo.processInfo.environment];
  environment[@"CERTIFYD_NATIVE_SPLASH"] = @"1";
  environment[@"CERTIFYD_SPLASH_STATUS_FILE"] = self.statusPath;
  task.environment = environment;
  self.task = task;

  __weak CertifydLauncherDelegate *weakSelf = self;
  task.terminationHandler = ^(NSTask *finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      CertifydLauncherDelegate *selfRef = weakSelf;
      if (!selfRef) return;
      [selfRef.statusTimer invalidate];
      selfRef.statusTimer = nil;
      if (finished.terminationStatus == 0) {
        [selfRef.progress stopAnimation:nil];
        [selfRef.window orderOut:nil];
        [[NSFileManager defaultManager] removeItemAtPath:selfRef.statusPath error:nil];
        [NSApp terminate:nil];
        return;
      }
      NSString *message = [NSString stringWithContentsOfFile:selfRef.statusPath encoding:NSUTF8StringEncoding error:nil];
      message = [message stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
      if (!message.length) message = @"Core could not start. Open the logs for details.";
      [selfRef.progress stopAnimation:nil];
      selfRef.progress.hidden = YES;
      selfRef.retryButton.hidden = NO;
      selfRef.logsButton.hidden = NO;
      [selfRef setStatus:message error:YES];
      [selfRef.window makeKeyAndOrderFront:nil];
      [NSApp activateIgnoringOtherApps:YES];
    });
  };

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    [self.progress stopAnimation:nil];
    self.progress.hidden = YES;
    self.retryButton.hidden = NO;
    self.logsButton.hidden = NO;
    [self setStatus:error.localizedDescription ?: @"The launcher could not start." error:YES];
    return;
  }
  self.statusTimer = [NSTimer scheduledTimerWithTimeInterval:0.2 target:self selector:@selector(pollStatus:) userInfo:nil repeats:YES];
}

- (void)retry:(id)sender {
  (void)sender;
  if (self.task.running) return;
  [self launchCore];
}

- (void)viewLogs:(id)sender {
  (void)sender;
  NSString *logs = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ContentBox/logs"];
  [[NSFileManager defaultManager] createDirectoryAtPath:logs withIntermediateDirectories:YES attributes:nil error:nil];
  [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:logs isDirectory:YES]];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 430, 300)
                                            styleMask:NSWindowStyleMaskBorderless
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
  self.window.backgroundColor = [NSColor colorWithRed:0.03 green:0.09 blue:0.13 alpha:1.0];
  self.window.opaque = YES;
  self.window.hasShadow = YES;
  self.window.level = NSFloatingWindowLevel;
  [self.window center];

  NSView *content = self.window.contentView;
  NSString *resources = [self.scriptPath stringByDeletingLastPathComponent];
  NSString *iconPath = [resources stringByAppendingPathComponent:@"assets/certifyd-core.png"];
  NSImageView *logo = [[NSImageView alloc] initWithFrame:NSMakeRect(169, 174, 92, 92)];
  logo.imageScaling = NSImageScaleProportionallyUpOrDown;
  logo.image = [[NSImage alloc] initWithContentsOfFile:iconPath];
  [content addSubview:logo];

  NSTextField *title = [NSTextField labelWithString:@"Certifyd Core"];
  title.frame = NSMakeRect(35, 132, 360, 34);
  title.alignment = NSTextAlignmentCenter;
  title.font = [NSFont systemFontOfSize:25 weight:NSFontWeightSemibold];
  title.textColor = NSColor.whiteColor;
  [content addSubview:title];

  self.statusLabel = [NSTextField wrappingLabelWithString:@"Preparing the local dashboard…"];
  self.statusLabel.frame = NSMakeRect(35, 75, 360, 44);
  self.statusLabel.alignment = NSTextAlignmentCenter;
  self.statusLabel.font = [NSFont systemFontOfSize:14];
  [self setStatus:self.statusLabel.stringValue error:NO];
  [content addSubview:self.statusLabel];

  self.progress = [[NSProgressIndicator alloc] initWithFrame:NSMakeRect(80, 51, 270, 6)];
  self.progress.style = NSProgressIndicatorStyleBar;
  self.progress.indeterminate = YES;
  [content addSubview:self.progress];

  self.retryButton = [NSButton buttonWithTitle:@"Retry" target:self action:@selector(retry:)];
  self.retryButton.frame = NSMakeRect(105, 28, 105, 34);
  self.retryButton.bezelStyle = NSBezelStyleRounded;
  self.retryButton.hidden = YES;
  [content addSubview:self.retryButton];

  self.logsButton = [NSButton buttonWithTitle:@"View Logs" target:self action:@selector(viewLogs:)];
  self.logsButton.frame = NSMakeRect(220, 28, 105, 34);
  self.logsButton.bezelStyle = NSBezelStyleRounded;
  self.logsButton.hidden = YES;
  [content addSubview:self.logsButton];

  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
  [self launchCore];
}

@end

static int resolve_script(char script[PATH_MAX]) {
  char executable[PATH_MAX], resolved[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, resolved)) return 0;
  char *slash = strrchr(resolved, '/');
  if (!slash) return 0;
  *slash = '\0';
  int length = snprintf(script, PATH_MAX, "%s/../Resources/CertifydCoreLauncher.sh", resolved);
  return length >= 0 && length < PATH_MAX && access(script, R_OK) == 0;
}

static int run_headless(const char *script, int argc, char **argv) {
  char **args = calloc((size_t)argc + 4, sizeof(char *));
  if (!args) return 1;
  args[0] = "/bin/bash";
  args[1] = "--noprofile";
  args[2] = "--norc";
  args[3] = (char *)script;
  for (int index = 1; index < argc; index++) args[index + 3] = argv[index];
  execv(args[0], args);
  perror("Certifyd Core: cannot start bash");
  free(args);
  return 1;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    char script[PATH_MAX];
    if (!resolve_script(script)) {
      fputs("Certifyd Core: startup script missing or path too long\n", stderr);
      return 1;
    }
    unsetenv("BASH_ENV");
    unsetenv("ENV");
    if (getenv("CERTIFYD_LAUNCHER_NO_UI") || getenv("CERTIFYD_NO_BROWSER") || getenv("CI")) {
      return run_headless(script, argc, argv);
    }
    NSApplication *application = [NSApplication sharedApplication];
    application.activationPolicy = NSApplicationActivationPolicyRegular;
    CertifydLauncherDelegate *delegate = [[CertifydLauncherDelegate alloc] init];
    delegate.scriptPath = [NSString stringWithUTF8String:script];
    delegate.statusPath = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"certifyd-core-launcher.%d.status", getpid()]];
    NSMutableArray<NSString *> *arguments = [NSMutableArray array];
    for (int index = 1; index < argc; index++) [arguments addObject:[NSString stringWithUTF8String:argv[index]]];
    delegate.forwardedArguments = arguments;
    application.delegate = delegate;
    [application run];
  }
  return 0;
}
