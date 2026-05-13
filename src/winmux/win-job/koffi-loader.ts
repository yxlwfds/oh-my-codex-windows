/**
 * Lazy `koffi` loader + `kernel32.dll` bindings used by JobObject.
 *
 * We import koffi dynamically so non-Windows callers can still `import` the
 * winmux module without paying the cost of loading koffi unless they're
 * actually on the Windows side. Errors during load surface as
 * `JobObjectUnavailableError`, which the daemon translates into a hard exit
 * (no fallback path).
 */

import { createRequire } from "module";
import type { IKoffiLib, IKoffiCType, KoffiFunc } from "koffi";

const requireFromHere = createRequire(import.meta.url);

export class JobObjectUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "JobObjectUnavailableError";
  }
}

// Win32 SDK constants. Values transcribed verbatim from <winnt.h>.
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
export const JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x0800;
export const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x1000;
export const JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x0400;

export const JobObjectExtendedLimitInformation = 9;

// PROCESS_TERMINATE | PROCESS_SET_QUOTA — minimum rights for AssignProcessToJobObject.
export const PROCESS_TERMINATE = 0x0001;
export const PROCESS_SET_QUOTA = 0x0100;

export interface KernelBindings {
  koffi: typeof import("koffi");
  kernel32: IKoffiLib;
  IO_COUNTERS: IKoffiCType;
  BASIC_LIMIT: IKoffiCType;
  EXTENDED_LIMIT: IKoffiCType;
  CreateJobObjectW: KoffiFunc<(security: null, name: null) => number | bigint>;
  SetInformationJobObject: KoffiFunc<
    (job: number | bigint, infoClass: number, info: unknown, length: number) => number
  >;
  AssignProcessToJobObject: KoffiFunc<(job: number | bigint, process: number | bigint) => number>;
  TerminateJobObject: KoffiFunc<(job: number | bigint, exitCode: number) => number>;
  OpenProcess: KoffiFunc<(access: number, inherit: number, pid: number) => number | bigint>;
  CloseHandle: KoffiFunc<(handle: number | bigint) => number>;
  GetLastError: KoffiFunc<() => number>;
}

let cached: KernelBindings | null = null;

export function loadKernelBindings(): KernelBindings {
  if (cached) return cached;
  if (process.platform !== "win32") {
    throw new JobObjectUnavailableError(
      "Job Object support is Windows-only (process.platform=" + process.platform + ").",
    );
  }

  let koffi: typeof import("koffi");
  try {
    koffi = requireFromHere("koffi") as typeof import("koffi");
  } catch (err) {
    throw new JobObjectUnavailableError(
      `Failed to load koffi: ${(err as Error).message}. Install dependencies with \`npm install\`.`,
      err,
    );
  }

  let kernel32: IKoffiLib;
  try {
    kernel32 = koffi.load("kernel32.dll");
  } catch (err) {
    throw new JobObjectUnavailableError(
      `Failed to load kernel32.dll via koffi: ${(err as Error).message}.`,
      err,
    );
  }

  const IO_COUNTERS = koffi.struct("IO_COUNTERS", {
    ReadOperationCount: "uint64",
    WriteOperationCount: "uint64",
    OtherOperationCount: "uint64",
    ReadTransferCount: "uint64",
    WriteTransferCount: "uint64",
    OtherTransferCount: "uint64",
  });

  const BASIC_LIMIT = koffi.struct("JOBOBJECT_BASIC_LIMIT_INFORMATION", {
    PerProcessUserTimeLimit: "int64",
    PerJobUserTimeLimit: "int64",
    LimitFlags: "uint32",
    MinimumWorkingSetSize: "size_t",
    MaximumWorkingSetSize: "size_t",
    ActiveProcessLimit: "uint32",
    Affinity: "size_t",
    PriorityClass: "uint32",
    SchedulingClass: "uint32",
  });

  const EXTENDED_LIMIT = koffi.struct("JOBOBJECT_EXTENDED_LIMIT_INFORMATION", {
    BasicLimitInformation: BASIC_LIMIT,
    IoInfo: IO_COUNTERS,
    ProcessMemoryLimit: "size_t",
    JobMemoryLimit: "size_t",
    PeakProcessMemoryUsed: "size_t",
    PeakJobMemoryUsed: "size_t",
  });

  const CreateJobObjectW = kernel32.func(
    "void* __stdcall CreateJobObjectW(void* lpJobAttributes, const char16_t* lpName)",
  ) as unknown as KernelBindings["CreateJobObjectW"];
  // For the third arg we pass a typed struct (by const-pointer) so koffi can
  // marshal the JS object into the right memory layout.
  const SetInformationJobObject = kernel32.func(
    "SetInformationJobObject",
    "int",
    ["void*", "int32_t", koffi.pointer(EXTENDED_LIMIT), "uint32_t"],
  ) as unknown as KernelBindings["SetInformationJobObject"];
  const AssignProcessToJobObject = kernel32.func(
    "int __stdcall AssignProcessToJobObject(void* hJob, void* hProcess)",
  ) as unknown as KernelBindings["AssignProcessToJobObject"];
  const TerminateJobObject = kernel32.func(
    "int __stdcall TerminateJobObject(void* hJob, uint32_t uExitCode)",
  ) as unknown as KernelBindings["TerminateJobObject"];
  const OpenProcess = kernel32.func(
    "void* __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)",
  ) as unknown as KernelBindings["OpenProcess"];
  const CloseHandle = kernel32.func(
    "int __stdcall CloseHandle(void* hObject)",
  ) as unknown as KernelBindings["CloseHandle"];
  const GetLastError = kernel32.func("uint32_t __stdcall GetLastError()") as unknown as KernelBindings["GetLastError"];

  cached = {
    koffi,
    kernel32,
    IO_COUNTERS,
    BASIC_LIMIT,
    EXTENDED_LIMIT,
    CreateJobObjectW,
    SetInformationJobObject,
    AssignProcessToJobObject,
    TerminateJobObject,
    OpenProcess,
    CloseHandle,
    GetLastError,
  };
  return cached;
}
