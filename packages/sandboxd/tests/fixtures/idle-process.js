const marker = process.argv[2] ?? "idle-process";

process.title = marker;

Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
