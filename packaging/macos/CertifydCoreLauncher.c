#import <Cocoa/Cocoa.h>
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/file.h>

@interface CertifydLauncherDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) NSTextField *statusLabel;
@property(nonatomic, strong) NSProgressIndicator *progress;
@property(nonatomic, strong) NSButton *retryButton;
@property(nonatomic, strong) NSButton *logsButton;
@property(nonatomic, strong) NSTask *task;
@property(nonatomic, strong) NSTimer *statusTimer;
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, strong) NSMenuItem *healthItem;
@property(nonatomic, strong) NSMenuItem *startItem;
@property(nonatomic, strong) NSMenuItem *stopItem;
@property(nonatomic, strong) NSTimer *healthTimer;
@property(nonatomic, assign) BOOL coreHealthy;
@property(nonatomic, copy) NSString *scriptPath;
@property(nonatomic, copy) NSString *statusPath;
@property(nonatomic, copy) NSString *resourcesPath;
@property(nonatomic, copy) NSArray<NSString *> *forwardedArguments;
@end

@implementation CertifydLauncherDelegate

- (void)setStatus:(NSString *)message error:(BOOL)isError {
  self.statusLabel.stringValue = message.length ? message : @"Preparing the local dashboard...";
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
  if (self.task.running) return;
  self.retryButton.hidden = YES;
  self.logsButton.hidden = YES;
  self.progress.hidden = NO;
  [self.progress startAnimation:nil];
  [self setStatus:@"Checking the local runtime..." error:NO];
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
        [selfRef refreshCoreHealth:nil];
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
      [selfRef refreshCoreHealth:nil];
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

- (NSString *)dataRoot {
  NSString *override = NSProcessInfo.processInfo.environment[@"CONTENTBOX_ROOT"];
  return override.length ? override : [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ContentBox"];
}

- (NSString *)dashboardURL {
  NSString *envPath = [[self dataRoot] stringByAppendingPathComponent:@"config/api.env"];
  NSString *contents = [NSString stringWithContentsOfFile:envPath encoding:NSUTF8StringEncoding error:nil];
  for (NSString *line in [contents componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]) {
    if ([line hasPrefix:@"APP_BASE_URL="]) {
      NSString *value = [line substringFromIndex:13];
      return [value stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"\"'"]];
    }
  }
  return @"http://127.0.0.1:4000";
}

- (void)runHelper:(NSString *)name arguments:(NSArray<NSString *> *)arguments wait:(BOOL)wait {
  NSString *path = [self.resourcesPath stringByAppendingPathComponent:name];
  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
  task.arguments = [@[@"--noprofile", @"--norc", path] arrayByAddingObjectsFromArray:arguments ?: @[]];
  [task launchAndReturnError:nil];
  if (wait) [task waitUntilExit];
}

- (void)openDashboard:(id)sender {
  (void)sender;
  if (!self.coreHealthy) {
    self.forwardedArguments = @[];
    [self.window makeKeyAndOrderFront:nil];
    [self launchCore];
    return;
  }
  [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:[self dashboardURL]]];
}

- (void)refreshCoreHealth:(NSTimer *)timer {
  (void)timer;
  NSString *path = [self.resourcesPath stringByAppendingPathComponent:@"status.sh"];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
    task.arguments = @[@"--noprofile", @"--norc", path];
    NSPipe *pipe = [NSPipe pipe];
    task.standardOutput = pipe;
    task.standardError = [NSFileHandle fileHandleWithNullDevice];
    BOOL launched = [task launchAndReturnError:nil];
    NSData *data = launched ? [pipe.fileHandleForReading readDataToEndOfFile] : nil;
    if (launched) [task waitUntilExit];
    NSString *result = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"";
    BOOL healthy = [result containsString:@"Alive:  true"] && [result containsString:@"Health: true"];
    dispatch_async(dispatch_get_main_queue(), ^{
      self.coreHealthy = healthy;
      self.healthItem.title = healthy ? @"Core running" : @"Core stopped or unavailable";
      self.startItem.enabled = !healthy && !self.task.running;
      self.stopItem.enabled = healthy;
      self.statusItem.button.toolTip = self.healthItem.title;
    });
  });
}

- (void)startCore:(id)sender {
  (void)sender;
  if (self.task.running || self.coreHealthy) return;
  self.forwardedArguments = @[];
  [self.window makeKeyAndOrderFront:nil];
  [self launchCore];
}

- (void)copyLANAddress:(id)sender {
  (void)sender;
  [NSPasteboard.generalPasteboard clearContents];
  [NSPasteboard.generalPasteboard setString:[self dashboardURL] forType:NSPasteboardTypeString];
}

- (void)enableLAN:(id)sender {
  (void)sender;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Enable LAN access?";
  alert.informativeText = @"Allow authenticated access to Certifyd Core from devices on your trusted local network?";
  [alert addButtonWithTitle:@"Enable"];
  [alert addButtonWithTitle:@"Cancel"];
  if ([alert runModal] != NSAlertFirstButtonReturn) return;
  [self runHelper:@"stop.sh" arguments:@[] wait:YES];
  self.forwardedArguments = @[@"--lan"];
  [self.window makeKeyAndOrderFront:nil];
  [self launchCore];
}

- (void)restartCore:(id)sender {
  (void)sender;
  [self runHelper:@"stop.sh" arguments:@[] wait:YES];
  self.forwardedArguments = @[];
  [self.window makeKeyAndOrderFront:nil];
  [self launchCore];
}

- (void)stopCore:(id)sender {
  (void)sender;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    [self runHelper:@"stop.sh" arguments:@[] wait:YES];
    dispatch_async(dispatch_get_main_queue(), ^{ [self refreshCoreHealth:nil]; });
  });
}

- (void)quitCore:(id)sender {
  (void)sender;
  [self runHelper:@"stop.sh" arguments:@[] wait:YES];
  [NSApp terminate:nil];
}

- (BOOL)isNewInstall {
  NSString *root = [self dataRoot];
  NSFileManager *fm = NSFileManager.defaultManager;
  return ![fm fileExistsAtPath:[root stringByAppendingPathComponent:@"config/api.env"]] &&
    ![fm fileExistsAtPath:[root stringByAppendingPathComponent:@"contentbox.db"]] &&
    ![fm fileExistsAtPath:[root stringByAppendingPathComponent:@"state.json"]];
}

- (void)configureStatusMenu {
  self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
  NSImage *menuIcon = [[NSImage alloc] initWithContentsOfFile:[self.resourcesPath stringByAppendingPathComponent:@"assets/certifyd-core.png"]];
  menuIcon.size = NSMakeSize(18, 18);
  self.statusItem.button.image = menuIcon;
  self.statusItem.button.toolTip = @"Certifyd Core";
  NSMenu *menu = [[NSMenu alloc] init];
  self.healthItem = [menu addItemWithTitle:@"Checking Core…" action:nil keyEquivalent:@""];
  self.healthItem.enabled = NO;
  [menu addItem:NSMenuItem.separatorItem];
  [menu addItemWithTitle:@"Open Dashboard" action:@selector(openDashboard:) keyEquivalent:@""];
  [menu addItemWithTitle:@"Copy LAN Address" action:@selector(copyLANAddress:) keyEquivalent:@""];
  [menu addItemWithTitle:@"Enable or Refresh LAN Access" action:@selector(enableLAN:) keyEquivalent:@""];
  [menu addItem:NSMenuItem.separatorItem];
  self.startItem = [menu addItemWithTitle:@"Start Core" action:@selector(startCore:) keyEquivalent:@""];
  [menu addItemWithTitle:@"Restart Core" action:@selector(restartCore:) keyEquivalent:@""];
  self.stopItem = [menu addItemWithTitle:@"Stop Core" action:@selector(stopCore:) keyEquivalent:@""];
  [menu addItemWithTitle:@"View Logs" action:@selector(viewLogs:) keyEquivalent:@""];
  [menu addItem:NSMenuItem.separatorItem];
  [menu addItemWithTitle:@"Quit Certifyd Core" action:@selector(quitCore:) keyEquivalent:@""];
  for (NSMenuItem *item in menu.itemArray) item.target = self;
  self.statusItem.menu = menu;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
  (void)sender;
  if (!flag) [self openDashboard:nil];
  return YES;
}

- (void)retry:(id)sender {
  (void)sender;
  if (self.task.running) return;
  [self launchCore];
}

- (void)viewLogs:(id)sender {
  (void)sender;
  NSString *logs = [[self dataRoot] stringByAppendingPathComponent:@"logs"];
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
  self.resourcesPath = resources;
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

  self.statusLabel = [NSTextField wrappingLabelWithString:@"Preparing the local dashboard..."];
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
  [self configureStatusMenu];
  self.healthTimer = [NSTimer scheduledTimerWithTimeInterval:8.0 target:self selector:@selector(refreshCoreHealth:) userInfo:nil repeats:YES];
  [self refreshCoreHealth:nil];
  if ([self isNewInstall] && self.forwardedArguments.count == 0) {
    NSMutableArray<NSString *> *firstRun = [NSMutableArray array];
    NSAlert *lan = [[NSAlert alloc] init];
    lan.messageText = @"Use Core on your local network?";
    lan.informativeText = @"Allow authenticated access from your phone and other devices on this trusted local network?";
    [lan addButtonWithTitle:@"Allow"];
    [lan addButtonWithTitle:@"Not Now"];
    if ([lan runModal] == NSAlertFirstButtonReturn) [firstRun addObject:@"--lan"];
    NSAlert *quick = [[NSAlert alloc] init];
    quick.messageText = @"Create a temporary public creator link?";
    quick.informativeText = @"This exposes only Core's public storefront routes, not the private dashboard.";
    [quick addButtonWithTitle:@"Allow"];
    [quick addButtonWithTitle:@"Not Now"];
    if ([quick runModal] == NSAlertFirstButtonReturn) [firstRun addObject:@"--first-run-quick"];
    self.forwardedArguments = firstRun;
  }
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
    NSString *dataRoot = NSProcessInfo.processInfo.environment[@"CONTENTBOX_ROOT"];
    if (!dataRoot.length) dataRoot = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/ContentBox"];
    NSString *stateDir = [dataRoot stringByAppendingPathComponent:@"state"];
    [[NSFileManager defaultManager] createDirectoryAtPath:stateDir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *lockPath = [stateDir stringByAppendingPathComponent:@"menu-controller.lock"];
    int controllerLock = open(lockPath.fileSystemRepresentation, O_CREAT | O_RDWR, 0600);
    if (controllerLock < 0) {
      fputs("Certifyd Core: cannot create menu controller lock\n", stderr);
      return 1;
    }
    if (flock(controllerLock, LOCK_EX | LOCK_NB) != 0) {
      if (controllerLock >= 0) close(controllerLock);
      [[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:@"http://127.0.0.1:4000"]];
      return 0;
    }
    NSApplication *application = [NSApplication sharedApplication];
    application.activationPolicy = NSApplicationActivationPolicyAccessory;
    CertifydLauncherDelegate *delegate = [[CertifydLauncherDelegate alloc] init];
    delegate.scriptPath = [NSString stringWithUTF8String:script];
    delegate.statusPath = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"certifyd-core-launcher.%d.status", getpid()]];
    NSMutableArray<NSString *> *arguments = [NSMutableArray array];
    for (int index = 1; index < argc; index++) [arguments addObject:[NSString stringWithUTF8String:argv[index]]];
    delegate.forwardedArguments = arguments;
    application.delegate = delegate;
    [application run];
    close(controllerLock);
  }
  return 0;
}
