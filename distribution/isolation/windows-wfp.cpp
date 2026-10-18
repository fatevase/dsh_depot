// CI-only network guard. Dynamic WFP objects disappear when this process exits.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fwpmu.h>
#include <rpc.h>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#pragma comment(lib, "fwpuclnt.lib")
#pragma comment(lib, "rpcrt4.lib")
static void check(DWORD code, const char* operation) {
  if (code != ERROR_SUCCESS) throw std::runtime_error(std::string(operation) + " failed: " + std::to_string(code));
}
static std::wstring quote(const std::wstring& s) {
  std::wstring out = L"\""; size_t slashes = 0;
  for (wchar_t ch : s) {
    if (ch == L'\\') { ++slashes; continue; }
    out.append(slashes * (ch == L'"' ? 2 : 1), L'\\'); slashes = 0;
    if (ch == L'"') out += L'\\'; out += ch;
  }
  out.append(slashes * 2, L'\\'); return out + L'"';
}
static void block(HANDLE engine, const GUID& sublayer, const GUID& layer, FWP_RANGE0* range = nullptr) {
  FWPM_FILTER0 filter{}; filter.layerKey = layer; filter.subLayerKey = sublayer;
  filter.displayData.name = const_cast<wchar_t*>(L"DSH temporary offline verification");
  filter.action.type = FWP_ACTION_BLOCK;
  UINT64 weight = UINT64_MAX; filter.weight.type = FWP_UINT64; filter.weight.uint64 = &weight;
  FWPM_FILTER_CONDITION0 condition{};
  if (range) {
    condition.fieldKey = FWPM_CONDITION_IP_REMOTE_ADDRESS; condition.matchType = FWP_MATCH_RANGE;
    condition.conditionValue.type = FWP_RANGE_TYPE; condition.conditionValue.rangeValue = range;
    filter.numFilterConditions = 1; filter.filterCondition = &condition;
  }
  check(FwpmFilterAdd0(engine, &filter, nullptr, nullptr), "FwpmFilterAdd0");
}
int wmain(int argc, wchar_t** argv) {
  HANDLE engine = nullptr, job = nullptr; PROCESS_INFORMATION process{};
  int exitCode = 125;
  try {
    const wchar_t* ci = _wgetenv(L"GITHUB_ACTIONS"); const wchar_t* runner = _wgetenv(L"RUNNER_ENVIRONMENT");
    if (!ci || !runner || std::wstring(ci) != L"true" || std::wstring(runner) != L"github-hosted") throw std::runtime_error("Only ephemeral GitHub-hosted CI runners are permitted");
    if (argc < 4 || (std::wstring(argv[1]) != L"offline" && std::wstring(argv[1]) != L"loopback")) throw std::runtime_error("Expected mode, timeout milliseconds, executable and arguments");
    const DWORD timeout = std::stoul(argv[2]); if (!timeout || timeout > 180000) throw std::runtime_error("Invalid timeout");
    job = CreateJobObjectW(nullptr, nullptr); if (!job) check(GetLastError(), "CreateJobObjectW");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) check(GetLastError(), "SetInformationJobObject");
    FWPM_SESSION0 session{}; session.flags = FWPM_SESSION_FLAG_DYNAMIC;
    check(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, &session, &engine), "FwpmEngineOpen0");
    check(FwpmTransactionBegin0(engine, 0), "FwpmTransactionBegin0");
    FWPM_SUBLAYER0 sublayer{}; check(UuidCreate(&sublayer.subLayerKey), "UuidCreate");
    sublayer.displayData.name = const_cast<wchar_t*>(L"DSH temporary verification"); sublayer.weight = 0xffff;
    check(FwpmSubLayerAdd0(engine, &sublayer, nullptr), "FwpmSubLayerAdd0");
    const bool offline = std::wstring(argv[1]) == L"offline";
    for (const GUID& layer : {FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4}) {
      if (offline) block(engine, sublayer.subLayerKey, layer);
      else {
        // The host and observer use 127.0.0.1. Every other IPv4 address is denied.
        FWP_RANGE0 low{}; low.valueLow.type = low.valueHigh.type = FWP_UINT32;
        low.valueLow.uint32 = 0; low.valueHigh.uint32 = 0x7effffff;
        FWP_RANGE0 high{}; high.valueLow.type = high.valueHigh.type = FWP_UINT32;
        high.valueLow.uint32 = 0x80000000; high.valueHigh.uint32 = 0xffffffff;
        block(engine, sublayer.subLayerKey, layer, &low); block(engine, sublayer.subLayerKey, layer, &high);
      }
    }
    // Explicitly block native IPv6 and dual-stack IPv4-mapped connections.
    block(engine, sublayer.subLayerKey, FWPM_LAYER_ALE_AUTH_CONNECT_V6);
    block(engine, sublayer.subLayerKey, FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6);
    check(FwpmTransactionCommit0(engine), "FwpmTransactionCommit0");
    std::wstring command; for (int i = 3; i < argc; ++i) { if (i > 3) command += L' '; command += quote(argv[i]); }
    std::vector<wchar_t> mutableCommand(command.begin(), command.end()); mutableCommand.push_back(0);
    STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE); startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE); startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    if (!CreateProcessW(argv[3], mutableCommand.data(), nullptr, nullptr, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) check(GetLastError(), "CreateProcessW");
    if (!AssignProcessToJobObject(job, process.hProcess)) check(GetLastError(), "AssignProcessToJobObject");
    if (ResumeThread(process.hThread) == static_cast<DWORD>(-1)) check(GetLastError(), "ResumeThread");
    const DWORD waited = WaitForSingleObject(process.hProcess, timeout);
    if (waited == WAIT_TIMEOUT) { TerminateJobObject(job, 124); exitCode = 124; }
    else { if (waited != WAIT_OBJECT_0) check(GetLastError(), "WaitForSingleObject"); DWORD code; if (!GetExitCodeProcess(process.hProcess, &code)) check(GetLastError(), "GetExitCodeProcess"); exitCode = static_cast<int>(code); }
  } catch (const std::exception& error) { std::cerr << "WFP guard: " << error.what() << '\n'; }
  // Kill descendants before releasing network restrictions, including after failure.
  if (process.hProcess && job) TerminateJobObject(job, exitCode);
  if (process.hProcess) TerminateProcess(process.hProcess, exitCode);
  if (process.hThread) CloseHandle(process.hThread);
  if (process.hProcess) CloseHandle(process.hProcess);
  if (job) CloseHandle(job);
  if (engine) FwpmEngineClose0(engine);
  return exitCode;
}
