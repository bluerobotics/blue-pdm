using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// SolidWorks is running but no registered ProgID resolves it in the Running Object
    /// Table, so attaching is impossible. Distinct from "not running" because the fix is
    /// different: the user has to select the release that is actually open, or align the
    /// integrity level of the two processes.
    /// </summary>
    public class SolidWorksComInaccessibleException : Exception
    {
        /// <summary>Error string the app matches on. Do not change without updating the renderer.</summary>
        public const string Code = "SOLIDWORKS_COM_INACCESSIBLE";

        public SolidWorksComInaccessibleException(string message) : base(message)
        {
        }
    }

    /// <summary>
    /// Discovery of the SolidWorks COM registrations present on this machine.
    ///
    /// Every SolidWorks release registers a versioned ProgID (SldWorks.Application.32 for
    /// 2024, .34 for 2026, ...) plus the version-independent SldWorks.Application, which
    /// points at whichever release registered last. A running SolidWorks only publishes
    /// itself in the Running Object Table under its OWN versioned class, so on a machine
    /// with several releases installed a lookup of the version-independent ProgID returns
    /// MK_E_UNAVAILABLE even though SolidWorks is running. Attaching therefore has to try
    /// the versioned ProgIDs too.
    /// </summary>
    public static class SolidWorksComRegistry
    {
        /// <summary>Version-independent ProgID, whichever release claimed it last.</summary>
        public const string VersionIndependentProgId = "SldWorks.Application";

        // SolidWorks API version numbers are the release year minus this offset
        // (2024 -> 32, 2026 -> 34). Used both to derive a display year and to bound
        // the registry probe below.
        private const int ApiVersionYearOffset = 1992;
        private const int MinProbedApiVersion = 20;
        private const int MaxProbedApiVersion = 60;

        private static readonly Regex YearInDescription = new Regex(@"(20\d{2})", RegexOptions.Compiled);

        private static readonly object _lock = new object();
        private static List<ComInstall>? _installs;
        private static string? _preferredProgId;
        private static string? _resolvedProgId;

        /// <summary>
        /// One installed SolidWorks release, as described by its COM registration.
        /// </summary>
        public sealed class ComInstall
        {
            public string ProgId { get; set; } = string.Empty;
            public string Clsid { get; set; } = string.Empty;
            public string ExePath { get; set; } = string.Empty;
            public int ApiVersion { get; set; }
            public int Year { get; set; }

            /// <summary>Directory the release is installed in, or null when the exe path is unusable.</summary>
            public string? InstallDirectory
            {
                get
                {
                    try
                    {
                        return string.IsNullOrEmpty(ExePath) ? null : Path.GetDirectoryName(ExePath);
                    }
                    catch
                    {
                        return null;
                    }
                }
            }
        }

        /// <summary>
        /// The release the user picked in the app, as a versioned ProgID. Null means
        /// "no preference", in which case discovery order decides.
        /// </summary>
        public static string? PreferredProgId
        {
            get { lock (_lock) { return _preferredProgId; } }
        }

        /// <summary>
        /// The ProgID that last resolved to a live SolidWorks in the ROT. Tried first on
        /// subsequent lookups so the common case costs a single attempt.
        /// </summary>
        public static string? ResolvedProgId
        {
            get { lock (_lock) { return _resolvedProgId; } }
        }

        public static void SetPreferredProgId(string? progId)
        {
            lock (_lock)
            {
                _preferredProgId = string.IsNullOrWhiteSpace(progId) ? null : progId!.Trim();
            }
        }

        public static void SetResolvedProgId(string? progId)
        {
            lock (_lock)
            {
                _resolvedProgId = string.IsNullOrWhiteSpace(progId) ? null : progId!.Trim();
            }
        }

        /// <summary>
        /// Forget the ProgID that last worked, so the next attach re-evaluates every
        /// candidate. Called when the cached COM connection is dropped.
        /// </summary>
        public static void ClearResolvedProgId()
        {
            lock (_lock)
            {
                _resolvedProgId = null;
            }
        }

        /// <summary>
        /// Every SolidWorks COM registration found on this machine, newest first.
        /// Cached for the life of the process: installs do not appear while we run.
        /// </summary>
        public static IReadOnlyList<ComInstall> GetInstalls()
        {
            lock (_lock)
            {
                if (_installs != null) return _installs;
                _installs = DiscoverInstalls();
                return _installs;
            }
        }

        /// <summary>
        /// ProgIDs to try when attaching to a running SolidWorks, best candidate first:
        /// the one that last worked, then the user's choice, then any release whose
        /// executable matches a running SLDWORKS.exe, then the rest newest-first, and
        /// finally the version-independent ProgID.
        /// </summary>
        public static IReadOnlyList<string> GetAttachProgIdsInOrder()
        {
            var ordered = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            void Add(string? progId)
            {
                if (string.IsNullOrWhiteSpace(progId)) return;
                if (seen.Add(progId!)) ordered.Add(progId!);
            }

            Add(ResolvedProgId);
            Add(PreferredProgId);

            var installs = GetInstalls();
            var runningPaths = GetRunningSolidWorksExePaths();
            if (runningPaths.Count > 0)
            {
                foreach (var install in installs.Where(i => runningPaths.Contains(i.ExePath)))
                {
                    Add(install.ProgId);
                }
            }

            foreach (var install in installs)
            {
                Add(install.ProgId);
            }

            Add(VersionIndependentProgId);
            return ordered;
        }

        /// <summary>
        /// ProgID to use when launching a fresh SolidWorks. Honours the user's choice
        /// when that release is actually registered, otherwise the machine default.
        /// </summary>
        public static string GetLaunchProgId()
        {
            var preferred = PreferredProgId;
            if (!string.IsNullOrEmpty(preferred) &&
                GetInstalls().Any(i => string.Equals(i.ProgId, preferred, StringComparison.OrdinalIgnoreCase)))
            {
                return preferred!;
            }

            return VersionIndependentProgId;
        }

        /// <summary>
        /// Install directory of the release the user picked, or null when there is no
        /// usable preference. Used to load matching API redistributables.
        /// </summary>
        public static string? GetPreferredInstallDirectory()
        {
            var preferred = PreferredProgId;
            if (string.IsNullOrEmpty(preferred)) return null;

            return GetInstalls()
                .FirstOrDefault(i => string.Equals(i.ProgId, preferred, StringComparison.OrdinalIgnoreCase))
                ?.InstallDirectory;
        }

        /// <summary>
        /// Candidate paths for the Document Manager interop assembly, derived from the
        /// discovered installs. The preferred release comes first so the DM interop
        /// matches the SolidWorks release the user selected; loading a 2024 interop
        /// against 2026 files fails at read time.
        /// </summary>
        public static IReadOnlyList<string> GetDocumentManagerDllCandidates()
        {
            var candidates = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            void AddDirectory(string? directory)
            {
                if (string.IsNullOrEmpty(directory)) return;
                string path;
                try
                {
                    path = Path.Combine(directory!, "api", "redist", "SolidWorks.Interop.swdocumentmgr.dll");
                }
                catch
                {
                    return;
                }
                if (seen.Add(path)) candidates.Add(path);
            }

            AddDirectory(GetPreferredInstallDirectory());
            foreach (var install in GetInstalls())
            {
                AddDirectory(install.InstallDirectory);
            }

            return candidates;
        }

        /// <summary>
        /// Describe the discovered installs for the startup log, so a version mismatch
        /// is visible without attaching a debugger.
        /// </summary>
        public static string DescribeInstalls()
        {
            var installs = GetInstalls();
            if (installs.Count == 0) return "(none)";
            return string.Join(", ", installs.Select(i => $"{i.Year} [{i.ProgId}] {i.ExePath}"));
        }

        private static List<ComInstall> DiscoverInstalls()
        {
            var installs = new List<ComInstall>();

            for (int apiVersion = MaxProbedApiVersion; apiVersion >= MinProbedApiVersion; apiVersion--)
            {
                var progId = $"{VersionIndependentProgId}.{apiVersion}";
                var clsid = ReadProgIdClsid(progId);
                if (clsid == null) continue;

                installs.Add(new ComInstall
                {
                    ProgId = progId,
                    Clsid = clsid,
                    ExePath = ReadLocalServerPath(clsid) ?? string.Empty,
                    ApiVersion = apiVersion,
                    Year = ReadRegisteredYear(clsid) ?? (apiVersion + ApiVersionYearOffset),
                });
            }

            return installs;
        }

        private static string? ReadProgIdClsid(string progId)
        {
            try
            {
                using var key = Registry.ClassesRoot.OpenSubKey($@"{progId}\CLSID");
                return key?.GetValue(null) as string;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[SW-Registry] Failed reading CLSID for {progId}: {ex.Message}");
                return null;
            }
        }

        private static string? ReadLocalServerPath(string clsid)
        {
            try
            {
                using var key = Registry.ClassesRoot.OpenSubKey($@"CLSID\{clsid}\LocalServer32");
                var raw = key?.GetValue(null) as string;
                if (string.IsNullOrWhiteSpace(raw)) return null;

                // Registered as an 8.3 short path (C:\PROGRA~1\SOLIDW~1\SOLIDW~4\SLDWORKS.exe)
                // and sometimes quoted; normalise both so it can be compared to a process path.
                var trimmed = raw!.Trim().Trim('"');
                return ExpandShortPath(trimmed);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[SW-Registry] Failed reading LocalServer32 for {clsid}: {ex.Message}");
                return null;
            }
        }

        private static int? ReadRegisteredYear(string clsid)
        {
            try
            {
                using var key = Registry.ClassesRoot.OpenSubKey($@"CLSID\{clsid}");
                // Registered as e.g. "SldWorks 2026 Application"
                if (key?.GetValue(null) is not string description) return null;

                var match = YearInDescription.Match(description);
                return match.Success && int.TryParse(match.Groups[1].Value, out var year) ? year : null;
            }
            catch
            {
                return null;
            }
        }

        private static string ExpandShortPath(string path)
        {
            try
            {
                if (!File.Exists(path)) return path;
                return Path.GetFullPath(new FileInfo(path).FullName);
            }
            catch
            {
                return path;
            }
        }

        /// <summary>
        /// Executable paths of every SLDWORKS.exe currently running. Best effort: a
        /// process we cannot inspect is simply left out of the ordering hint.
        /// </summary>
        private static HashSet<string> GetRunningSolidWorksExePaths()
        {
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                foreach (var process in Process.GetProcessesByName("SLDWORKS"))
                {
                    try
                    {
                        var path = process.MainModule?.FileName;
                        if (!string.IsNullOrEmpty(path)) paths.Add(path!);
                    }
                    catch
                    {
                        // Access denied or exited between enumeration and inspection.
                    }
                    finally
                    {
                        process.Dispose();
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[SW-Registry] Failed enumerating SolidWorks processes: {ex.Message}");
            }

            return paths;
        }
    }
}
