# Snapshots

Snapshots are prepared sandbox images for published sandbox profile versions.

They make new sessions start from a profile-specific image instead of rebuilding everything from the shared base image every time. A snapshot captures the result of applying a published profile version's runtime plan and snapshot preparation script to a one-off sandbox, then stores the resulting provider image handle on that profile version. Initial snapshots and setup refreshes use the setup script; maintenance refresh snapshots use the saved snapshot maintenance script when one is configured and a usable current snapshot exists. Scheduled refresh uses setup preparation from the base image when those maintenance prerequisites are not met.

## What snapshots are for

Snapshots are for making sandbox startup faster and more predictable.

They are useful when a sandbox profile needs repeatable setup before users start sessions, such as:

- installing language runtimes or CLI tools
- preparing agent configuration
- applying setup scripts
- baking common dependencies into the launch image

Once a snapshot is ready, new sessions for that published profile version launch from the snapshot image.

## How it works

Publishing or refreshing a sandbox profile version creates a snapshot job.

```text
Publish or refresh profile version
      │
      ▼
Control plane creates a snapshot job
      │
      ▼
Data plane worker starts a one-off snapshot sandbox
      │
      ▼
Worker activates sandboxd with the snapshot operation kind
      │
      ▼
Provider captures an image from the sandbox
      │
      ▼
Worker destroys the one-off sandbox
      │
      ▼
Control plane stores the snapshot image handle
      │
      ▼
New sessions launch from that snapshot image
```

Snapshot sandboxes are internal system sandboxes. They are created with the `snapshot` purpose and destroyed after the image is captured.

## Lifecycle

Snapshots are tied to sandbox profile versions.

- Publishing a draft version queues the initial snapshot job.
- Manual refresh queues a new snapshot job for an already published version.
- Scheduled refresh can queue snapshot jobs for profiles that need regular rebuilds.
- A profile version is not usable for new sessions until its published version has a usable snapshot image.
- Failed refreshes keep the existing usable snapshot when one already exists.

Only one queued or running snapshot job is allowed per profile version at a time.

## What snapshots are not

Snapshots are not per-session durable storage. They do not preserve the ongoing filesystem changes from a user's sandbox session.

Use snapshots when you want many future sandboxes to start from the same prepared image. Sandboxes retain their own disk state across ordinary stop/start cycles.
