//go:build darwin

#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#import <stdlib.h>
#import <string.h>

extern void forklyOpenFilesBridge(char **paths, int count);

static BOOL forklyOpenFilesHookInstalled = NO;

static void forklyDeliverOpenPaths(NSArray<NSString *> *filenames) {
  if (filenames == nil || filenames.count == 0) {
    return;
  }
  NSUInteger n = filenames.count;
  char **paths = (char **)calloc(n, sizeof(char *));
  if (paths == NULL) {
    return;
  }
  int count = 0;
  for (NSUInteger i = 0; i < n; i++) {
    NSString *path = filenames[i];
    if (path == nil || path.length == 0) {
      continue;
    }
    paths[count] = strdup(path.fileSystemRepresentation);
    if (paths[count] != NULL) {
      count++;
    }
  }
  if (count > 0) {
    forklyOpenFilesBridge(paths, count);
  }
  for (int i = 0; i < count; i++) {
    free(paths[i]);
  }
  free(paths);
}

static BOOL forklyApplicationOpenFile(id self, SEL _cmd, NSApplication *app, NSString *filename) {
#pragma unused(self, _cmd, app)
  if (filename != nil && filename.length > 0) {
    forklyDeliverOpenPaths(@[filename]);
  }
  [NSApp replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
  return YES;
}

static void forklyApplicationOpenFiles(id self, SEL _cmd, NSApplication *app, NSArray<NSString *> *filenames) {
#pragma unused(self, _cmd, app)
  forklyDeliverOpenPaths(filenames);
  [NSApp replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
}

static const char *forklyAddMethod(Class cls, SEL sel, IMP imp, const char *types, const char *name) {
  Method existing = class_getInstanceMethod(cls, sel);
  if (existing != NULL) {
    return NULL;
  }
  if (!class_addMethod(cls, sel, imp, types)) {
    return name;
  }
  return NULL;
}

const char *forklyInstallOpenFilesDelegateHook(void) {
  if (forklyOpenFilesHookInstalled) {
    return NULL;
  }
  Class cls = objc_getClass("SystrayAppDelegate");
  if (cls == Nil) {
    return "SystrayAppDelegate class not found; fyne.io/systray may have changed";
  }

  const char *err = forklyAddMethod(cls, @selector(application:openFile:), (IMP)forklyApplicationOpenFile, "c@:@@",
                                    "failed to add application:openFile: to SystrayAppDelegate");
  if (err != NULL) {
    return err;
  }
  err = forklyAddMethod(cls, @selector(application:openFiles:), (IMP)forklyApplicationOpenFiles, "v@:@@",
                        "failed to add application:openFiles: to SystrayAppDelegate");
  if (err != NULL) {
    return err;
  }

  forklyOpenFilesHookInstalled = YES;
  return NULL;
}

BOOL forklySystrayRespondsToOpenFiles(void) {
  Class cls = objc_getClass("SystrayAppDelegate");
  if (cls == Nil) {
    return NO;
  }
  return class_getInstanceMethod(cls, @selector(application:openFiles:)) != NULL &&
         class_getInstanceMethod(cls, @selector(application:openFile:)) != NULL;
}

void forklyInvokeOpenFilesForTest(char **paths, int count) {
  if (paths == NULL || count <= 0) {
    return;
  }
  NSMutableArray<NSString *> *filenames = [NSMutableArray arrayWithCapacity:(NSUInteger)count];
  for (int i = 0; i < count; i++) {
    if (paths[i] == NULL) {
      continue;
    }
    NSString *path = [NSString stringWithUTF8String:paths[i]];
    if (path != nil) {
      [filenames addObject:path];
    }
  }
  forklyDeliverOpenPaths(filenames);
}
