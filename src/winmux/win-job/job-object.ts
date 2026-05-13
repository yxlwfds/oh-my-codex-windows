/**
 * Win32 Job Object wrapper. One instance is created by the daemon at startup.
 * Every spawned PTY process PID is `assign()`-ed to the job; when the daemon
 * process exits (gracefully OR via TerminateProcess), the kernel reaps every
 * process in the job thanks to `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
 *
 * This is the ultimate guarantee against zombie workers.
 */

import {
  JOB_OBJECT_LIMIT_BREAKAWAY_OK,
  JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
  JobObjectExtendedLimitInformation,
  JobObjectUnavailableError,
  PROCESS_SET_QUOTA,
  PROCESS_TERMINATE,
  loadKernelBindings,
  type KernelBindings,
} from "./koffi-loader.js";

export interface JobObjectAssignOptions {
  /** If true, swallow OpenProcess/AssignProcessToJobObject errors. */
  best_effort?: boolean;
}

export class JobObject {
  private constructor(
    private readonly bindings: KernelBindings,
    private readonly handle: number | bigint,
  ) {}

  static create(): JobObject {
    const bindings = loadKernelBindings();
    const handle = bindings.CreateJobObjectW(null, null);
    if (!handle) {
      const err = bindings.GetLastError();
      throw new JobObjectUnavailableError(`CreateJobObjectW failed (GetLastError=${err}).`);
    }

    const limits = {
      BasicLimitInformation: {
        PerProcessUserTimeLimit: 0n,
        PerJobUserTimeLimit: 0n,
        LimitFlags:
          JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
          | JOB_OBJECT_LIMIT_BREAKAWAY_OK
          | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
          | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        MinimumWorkingSetSize: 0n,
        MaximumWorkingSetSize: 0n,
        ActiveProcessLimit: 0,
        Affinity: 0n,
        PriorityClass: 0,
        SchedulingClass: 0,
      },
      IoInfo: {
        ReadOperationCount: 0n,
        WriteOperationCount: 0n,
        OtherOperationCount: 0n,
        ReadTransferCount: 0n,
        WriteTransferCount: 0n,
        OtherTransferCount: 0n,
      },
      ProcessMemoryLimit: 0n,
      JobMemoryLimit: 0n,
      PeakProcessMemoryUsed: 0n,
      PeakJobMemoryUsed: 0n,
    };
    const size = bindings.koffi.sizeof(bindings.EXTENDED_LIMIT);
    const ok = bindings.SetInformationJobObject(
      handle,
      JobObjectExtendedLimitInformation,
      limits,
      size,
    );
    if (!ok) {
      const err = bindings.GetLastError();
      bindings.CloseHandle(handle);
      throw new JobObjectUnavailableError(`SetInformationJobObject failed (GetLastError=${err}).`);
    }
    return new JobObject(bindings, handle);
  }

  /**
   * Add `pid` to the job. Best-effort by default — even if assignment fails the
   * caller's session is still tracked in SessionManager and will be torn down
   * via `pty.kill()` during shutdown; this is the OS-level safety net.
   */
  assign(pid: number, options: JobObjectAssignOptions = { best_effort: true }): boolean {
    const bindings = this.bindings;
    const access = PROCESS_TERMINATE | PROCESS_SET_QUOTA;
    const processHandle = bindings.OpenProcess(access, 0, pid);
    if (!processHandle) {
      if (options.best_effort) return false;
      const err = bindings.GetLastError();
      throw new JobObjectUnavailableError(`OpenProcess(pid=${pid}) failed (GetLastError=${err}).`);
    }
    const ok = bindings.AssignProcessToJobObject(this.handle, processHandle);
    bindings.CloseHandle(processHandle);
    if (!ok) {
      if (options.best_effort) return false;
      const err = bindings.GetLastError();
      throw new JobObjectUnavailableError(
        `AssignProcessToJobObject(pid=${pid}) failed (GetLastError=${err}).`,
      );
    }
    return true;
  }

  /**
   * Explicitly terminate every process in the job. Used during graceful
   * shutdown as a belt-and-suspenders measure; `dispose()`'s CloseHandle would
   * trigger the same kernel behaviour anyway thanks to KILL_ON_JOB_CLOSE.
   */
  terminateAll(exitCode = 1): void {
    this.bindings.TerminateJobObject(this.handle, exitCode);
  }

  /**
   * Close the underlying kernel handle. With KILL_ON_JOB_CLOSE set, this
   * immediately kills every process still inside the job.
   */
  dispose(): void {
    this.bindings.CloseHandle(this.handle);
  }
}
