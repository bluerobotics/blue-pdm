using System;
using System.Collections.Generic;
using System.Linq;

namespace BluePLM.SolidWorksService
{
    /// <summary>What a launch attempt turned out to have produced.</summary>
    public enum LaunchOutcome
    {
        /// <summary>A SolidWorks that did not exist before this attempt. Ours.</summary>
        Launched,

        /// <summary>
        /// COM handed back a SolidWorks that was already running. The attempt attached to
        /// someone else's session instead of starting one, so nothing here belongs to BluePLM.
        /// </summary>
        AttachedToExisting,

        /// <summary>
        /// A process was probably started but cannot be named. The COM handle is still ours to
        /// close, but no PID may be claimed from it.
        /// </summary>
        Unidentified,
    }

    /// <summary>The PID a launch produced, and how much that PID is worth.</summary>
    public readonly struct LaunchedProcess
    {
        public LaunchedProcess(int processId, LaunchOutcome outcome, string reason)
        {
            ProcessId = processId;
            Outcome = outcome;
            Reason = reason;
        }

        /// <summary>Zero unless <see cref="Outcome"/> is <see cref="LaunchOutcome.Launched"/>.</summary>
        public int ProcessId { get; }

        public LaunchOutcome Outcome { get; }

        /// <summary>Log-ready sentence naming the evidence behind <see cref="Outcome"/>.</summary>
        public string Reason { get; }

        /// <summary>
        /// Whether this process is BluePLM's to hide, to close on shutdown, and to hand to the
        /// host's ownership registry.
        /// </summary>
        public bool IsOurs => Outcome != LaunchOutcome.AttachedToExisting;
    }

    /// <summary>
    /// Decides which SLDWORKS.exe a launch attempt produced, from the PID SolidWorks reports and
    /// the PIDs that existed before the attempt.
    ///
    /// The snapshot is the whole point. <c>ISldWorks.GetProcessID</c> answers "which process is
    /// this COM object in", not "which process did you just start" - and CreateInstance against a
    /// running SolidWorks returns a handle on that one. Reporting its PID as launched writes a
    /// self-certifying ownership record for the user's own session, after which the watchdog is
    /// entitled to close it. Comparing against the snapshot is what tells a launch from an attach,
    /// and it costs one process enumeration.
    ///
    /// Pure, so the decision can be tested without SolidWorks installed.
    /// </summary>
    public static class LaunchedProcessResolver
    {
        /// <param name="reportedProcessId">What ISldWorks.GetProcessID said, or 0 if it would not say.</param>
        /// <param name="processIdsBeforeLaunch">
        /// Every SLDWORKS.exe seen immediately before the attempt, or null when the enumeration
        /// failed. Null is not an empty list: an enumeration that did not answer is no evidence
        /// that nothing was running, and without that evidence no PID can be shown to be new.
        /// </param>
        /// <param name="processIdsAfterLaunch">Every SLDWORKS.exe seen immediately after it returned.</param>
        public static LaunchedProcess Resolve(
            int reportedProcessId,
            IEnumerable<int>? processIdsBeforeLaunch,
            IEnumerable<int>? processIdsAfterLaunch)
        {
            if (processIdsBeforeLaunch == null)
            {
                return new LaunchedProcess(0, LaunchOutcome.Unidentified,
                    "the SLDWORKS.exe snapshot taken before the launch could not be read, so no PID can " +
                    "be shown to be one that was not already running");
            }

            var before = new HashSet<int>(processIdsBeforeLaunch);
            var after = (processIdsAfterLaunch ?? Enumerable.Empty<int>()).Distinct().ToArray();

            if (reportedProcessId > 0)
            {
                if (before.Contains(reportedProcessId))
                {
                    return new LaunchedProcess(0, LaunchOutcome.AttachedToExisting,
                        $"SolidWorks reported PID {reportedProcessId}, which was already running before the " +
                        "launch, so this handle is an existing session rather than one BluePLM started");
                }

                return new LaunchedProcess(reportedProcessId, LaunchOutcome.Launched,
                    $"SolidWorks reported PID {reportedProcessId}, which was not running beforehand");
            }

            var appeared = after.Where(pid => !before.Contains(pid)).ToArray();

            if (appeared.Length == 1)
            {
                return new LaunchedProcess(appeared[0], LaunchOutcome.Launched,
                    $"PID {appeared[0]} is the only SLDWORKS.exe that appeared during the launch");
            }

            if (appeared.Length == 0 && after.Length > 0)
            {
                return new LaunchedProcess(0, LaunchOutcome.AttachedToExisting,
                    "no new SLDWORKS.exe appeared during the launch, so the handle belongs to one that " +
                    "was already running");
            }

            return new LaunchedProcess(0, LaunchOutcome.Unidentified,
                $"{appeared.Length} SLDWORKS.exe process(es) appeared during the launch, so none of them " +
                "can be named as the one BluePLM started");
        }
    }
}
