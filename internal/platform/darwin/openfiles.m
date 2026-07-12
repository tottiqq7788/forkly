//go:build darwin

#import <Cocoa/Cocoa.h>
#import <stdlib.h>

extern void forklyOpenFilesBridge(char **paths, int count);

@interface ForklyOpenFilesHandler : NSObject
@end

@implementation ForklyOpenFilesHandler
- (void)handleOpenDocuments:(NSAppleEventDescriptor *)event
              withReplyEvent:(NSAppleEventDescriptor *)replyEvent {
  NSAppleEventDescriptor *list = [event paramDescriptorForKeyword:keyDirectObject];
  if (list == nil) {
    return;
  }
  NSInteger n = [list numberOfItems];
  if (n <= 0) {
    return;
  }
  char **paths = (char **)calloc((size_t)n, sizeof(char *));
  if (paths == NULL) {
    return;
  }
  int count = 0;
  for (NSInteger i = 1; i <= n; i++) {
    NSAppleEventDescriptor *item = [list descriptorAtIndex:i];
    if (item == nil) {
      continue;
    }
    NSString *urlString = [item stringValue];
    if (urlString == nil) {
      continue;
    }
    NSURL *url = [NSURL URLWithString:urlString];
    if (url == nil || ![url isFileURL]) {
      url = [NSURL fileURLWithPath:urlString];
    }
    if (url == nil) {
      continue;
    }
    NSString *path = url.path;
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
@end

static ForklyOpenFilesHandler *forklyOpenFilesHandler = nil;

static void ensureOpenFilesHandler(void) {
  if (forklyOpenFilesHandler != nil) {
    return;
  }
  forklyOpenFilesHandler = [[ForklyOpenFilesHandler alloc] init];
  [[NSAppleEventManager sharedAppleEventManager]
      setEventHandler:forklyOpenFilesHandler
          andSelector:@selector(handleOpenDocuments:withReplyEvent:)
        forEventClass:kCoreEventClass
           andEventID:kAEOpenDocuments];
}

char **forklyCollectLaunchOpenFiles(int *outCount) {
  *outCount = 0;
  ensureOpenFilesHandler();
  NSAppleEventDescriptor *ev = [[NSAppleEventManager sharedAppleEventManager] currentAppleEvent];
  if (ev == nil) {
    return NULL;
  }
  if ([ev eventClass] != kCoreEventClass || [ev eventID] != kAEOpenDocuments) {
    return NULL;
  }
  NSAppleEventDescriptor *list = [ev paramDescriptorForKeyword:keyDirectObject];
  if (list == nil) {
    return NULL;
  }
  NSInteger n = [list numberOfItems];
  if (n <= 0) {
    return NULL;
  }
  char **paths = (char **)calloc((size_t)n, sizeof(char *));
  if (paths == NULL) {
    return NULL;
  }
  int count = 0;
  for (NSInteger i = 1; i <= n; i++) {
    NSAppleEventDescriptor *item = [list descriptorAtIndex:i];
    if (item == nil) {
      continue;
    }
    NSString *urlString = [item stringValue];
    if (urlString == nil) {
      continue;
    }
    NSURL *url = [NSURL URLWithString:urlString];
    if (url == nil || ![url isFileURL]) {
      url = [NSURL fileURLWithPath:urlString];
    }
    if (url == nil) {
      continue;
    }
    NSString *path = url.path;
    if (path == nil || path.length == 0) {
      continue;
    }
    paths[count] = strdup(path.fileSystemRepresentation);
    if (paths[count] != NULL) {
      count++;
    }
  }
  if (count == 0) {
    free(paths);
    return NULL;
  }
  *outCount = count;
  return paths;
}

void forklyFreeStringArray(char **paths, int count) {
  if (paths == NULL) {
    return;
  }
  for (int i = 0; i < count; i++) {
    free(paths[i]);
  }
  free(paths);
}

void forklyStartOpenFilesWatcher(void) { ensureOpenFilesHandler(); }
