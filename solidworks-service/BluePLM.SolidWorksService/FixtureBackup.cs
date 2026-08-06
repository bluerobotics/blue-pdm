using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// A byte-for-byte copy of one fixture file, taken before a diagnostic writes to it, and the
    /// restore that puts it back.
    ///
    /// The failure modes that actually strand a modified fixture are the ones where nothing gets to
    /// run: an assertion that throws, Ctrl-C, a taskkill. So restore is reachable from three
    /// directions - <see cref="Restore"/> in a finally, <see cref="Dispose"/>, and a process-exit
    /// safety net - and is idempotent so all three firing is harmless. None of them survive a hard
    /// kill, which is why the copy is left where <see cref="FixtureSweeper"/> will find it and
    /// finish the job on the next run.
    ///
    /// The copy deliberately keeps the fixture's read-only attribute. That makes the backup the
    /// record of what the attribute was, so a run that dies after clearing it can still be undone.
    /// </summary>
    public sealed class FixtureBackup : IDisposable
    {
        /// <summary>Appended to the fixture's name. Recognised by the pre-flight sweep.</summary>
        public const string BackupSuffix = ".blueplm-probe.bak";

        /// <summary>
        /// Appended to the backup's name. Says which process the backup belongs to, so the sweep
        /// can tell a dead run's orphan - which it must restore - from a live run's working copy,
        /// which it must not touch.
        /// </summary>
        public const string OwnerSuffix = ".owner";

        private static readonly object RegistryGate = new object();
        private static readonly List<FixtureBackup> Pending = new List<FixtureBackup>();
        private static bool _safetyNetInstalled;

        private readonly object _gate = new object();
        private FixtureRestoreResult? _completed;

        private FixtureBackup(string filePath, string backupPath, string originalHash, bool wasReadOnly)
        {
            FilePath = filePath;
            BackupPath = backupPath;
            OriginalHash = originalHash;
            WasReadOnly = wasReadOnly;
        }

        /// <summary>The fixture being protected.</summary>
        public string FilePath { get; }

        /// <summary>Where its copy lives until the restore completes.</summary>
        public string BackupPath { get; }

        /// <summary>Where the note saying who owns <see cref="BackupPath"/> lives.</summary>
        public string OwnerPath => BackupPath + OwnerSuffix;

        /// <summary>SHA-256 of the fixture before anything wrote to it.</summary>
        public string OriginalHash { get; }

        /// <summary>Whether the fixture carried the read-only attribute. Part of its state.</summary>
        public bool WasReadOnly { get; }

        /// <summary>Whether the restore has completed successfully.</summary>
        public bool IsRestored
        {
            get { lock (_gate) return _completed?.Restored == true; }
        }

        /// <summary>
        /// Copy <paramref name="filePath"/> aside, refusing anything outside
        /// <paramref name="allowedRoot"/>.
        /// </summary>
        public static FixtureBackup Create(string filePath, string allowedRoot)
        {
            if (!RegressionFixtureGuard.IsInside(filePath, allowedRoot))
                throw new InvalidOperationException(RegressionFixtureGuard.DescribeRefusal(filePath, allowedRoot));

            if (!File.Exists(filePath))
                throw new FileNotFoundException($"Nothing to back up at {filePath}", filePath);

            var backupPath = filePath + BackupSuffix;
            var ownerPath = backupPath + OwnerSuffix;

            // An orphan holds the only copy of the original, and the fixture next to it is the
            // modified one. Overwriting it would destroy the original for good.
            if (File.Exists(backupPath))
            {
                throw new InvalidOperationException(
                    $"{backupPath} already exists, so an earlier run was interrupted and {filePath} may still be " +
                    "modified. Sweep the fixture folder before writing to it again.");
            }

            if (File.Exists(ownerPath))
            {
                throw new InvalidOperationException(
                    $"{ownerPath} already exists, so another run is backing up {filePath} right now or died " +
                    "between claiming it and copying it. Sweep the fixture folder before writing to it again.");
            }

            // Claimed before the copy exists, not after. A sweep that runs in the gap has to see an
            // owner it can check; a backup that appeared first with no owner beside it reads as an
            // orphan, and the sweep would restore it over the fixture this run is about to write.
            FixtureBackupOwner.Mine().WriteTo(ownerPath);

            try
            {
                File.Copy(filePath, backupPath);
            }
            catch
            {
                // Leaving a claim with nothing behind it would block every later run.
                TryDelete(ownerPath);
                throw;
            }

            var backup = new FixtureBackup(filePath, backupPath, FixtureFile.ComputeSha256(filePath), FixtureFile.IsReadOnly(filePath));
            Track(backup);
            return backup;
        }

        /// <summary>
        /// Put the fixture back: bytes, then read-only attribute, then remove the copy. Safe to call
        /// repeatedly, and reports rather than swallows anything that stops it finishing.
        /// </summary>
        public FixtureRestoreResult Restore()
        {
            lock (_gate)
            {
                if (_completed?.Restored == true) return _completed;

                _completed = RestoreCore();
                if (_completed.Restored) Untrack(this);
                return _completed;
            }
        }

        public void Dispose() => Restore();

        private FixtureRestoreResult RestoreCore()
        {
            if (!File.Exists(BackupPath))
            {
                // Either the write never happened, or the copy is gone and the fixture is on its own.
                if (File.Exists(FilePath) &&
                    string.Equals(FixtureFile.ComputeSha256(FilePath), OriginalHash, StringComparison.OrdinalIgnoreCase))
                {
                    ApplyReadOnly();
                    TryDelete(OwnerPath);
                    return FixtureRestoreResult.Success(FilePath, "the fixture already matches its original SHA-256");
                }

                return FixtureRestoreResult.Failure(FilePath,
                    $"the backup at {BackupPath} is gone and {FilePath} no longer matches its original SHA-256 " +
                    $"({OriginalHash}). Restore it from source control before running again.");
            }

            try
            {
                FixtureFile.ClearReadOnly(FilePath);
                File.Copy(BackupPath, FilePath, overwrite: true);
            }
            catch (Exception error)
            {
                return FixtureRestoreResult.Failure(FilePath,
                    $"could not copy {BackupPath} back over {FilePath}: {error.Message}. The backup has been kept.");
            }

            var restoredHash = FixtureFile.ComputeSha256(FilePath);
            if (!string.Equals(restoredHash, OriginalHash, StringComparison.OrdinalIgnoreCase))
            {
                return FixtureRestoreResult.Failure(FilePath,
                    $"{FilePath} is still wrong after restoring: expected SHA-256 {OriginalHash}, got {restoredHash}. " +
                    $"The backup has been kept at {BackupPath}.");
            }

            ApplyReadOnly();

            try
            {
                FixtureFile.ClearReadOnly(BackupPath);
                File.Delete(BackupPath);
            }
            catch (Exception error)
            {
                return FixtureRestoreResult.Failure(FilePath,
                    $"{FilePath} was restored, but its backup could not be removed from {BackupPath}: {error.Message}. " +
                    "The fixture folder is not clean.");
            }

            // Last, so a crash anywhere above leaves a claim the next sweep can still act on.
            TryDelete(OwnerPath);

            return FixtureRestoreResult.Success(FilePath,
                $"restored and verified ({restoredHash}), read-only={WasReadOnly}, backup removed");
        }

        private static void TryDelete(string path)
        {
            try
            {
                FixtureFile.ClearReadOnly(path);
                if (File.Exists(path)) File.Delete(path);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        private void ApplyReadOnly()
        {
            // File.Copy carries attributes across, but saying so explicitly means the restore does not
            // depend on that: a fixture left writable behaves differently for every later run.
            FixtureFile.SetReadOnly(FilePath, WasReadOnly);
        }

        #region Process-exit safety net

        private static void Track(FixtureBackup backup)
        {
            lock (RegistryGate)
            {
                Pending.Add(backup);
                if (_safetyNetInstalled) return;

                AppDomain.CurrentDomain.ProcessExit += (sender, args) => RestorePending("the process is exiting");
                Console.CancelKeyPress += (sender, args) =>
                {
                    // Deliberately not cancelling: restore, then let the interrupt do what it meant to.
                    RestorePending("Ctrl-C was pressed");
                };

                _safetyNetInstalled = true;
            }
        }

        private static void Untrack(FixtureBackup backup)
        {
            lock (RegistryGate) Pending.Remove(backup);
        }

        /// <summary>
        /// Restore everything still outstanding. Reached from the exit handlers, which have only a
        /// few seconds, so it reports to stderr rather than raising anything.
        /// </summary>
        private static void RestorePending(string reason)
        {
            FixtureBackup[] outstanding;
            lock (RegistryGate) outstanding = Pending.ToArray();

            if (outstanding.Length == 0) return;

            Console.Error.WriteLine($"[FIXTURE] {reason} with {outstanding.Length} fixture(s) still modified. Restoring.");

            foreach (var backup in outstanding)
            {
                var result = backup.Restore();
                Console.Error.WriteLine(result.Restored
                    ? $"[FIXTURE] {Path.GetFileName(result.FilePath)}: {result.Message}"
                    : $"[FIXTURE] RESTORE FAILED for {result.FilePath}: {result.Message}");
            }
        }

        #endregion

    }

    /// <summary>
    /// Who a backup belongs to.
    ///
    /// Without this, every <c>.blueplm-probe.bak</c> looks the same, and the sweep has to guess: it
    /// treated all of them as wreckage from a dead run, so a second probe starting in the same root
    /// would copy the first probe's backup over the fixture it was mid-way through writing and then
    /// delete it. The first probe's restore would then find no backup, and no copy of the original
    /// would exist anywhere.
    ///
    /// A process id alone is not identity - Windows reuses them - so the start time is recorded with
    /// it, and the machine name too, because a vault can be a share and a PID from another machine
    /// means nothing here.
    /// </summary>
    public sealed class FixtureBackupOwner
    {
        private const string ProcessIdKey = "pid";
        private const string StartedAtKey = "startedAtUtc";
        private const string MachineKey = "machine";

        public FixtureBackupOwner(int processId, string startedAtUtc, string machineName)
        {
            ProcessId = processId;
            StartedAtUtc = startedAtUtc;
            MachineName = machineName;
        }

        public int ProcessId { get; }

        /// <summary>Round-trip format, or empty when the process would not report it.</summary>
        public string StartedAtUtc { get; }

        public string MachineName { get; }

        /// <summary>The running process, as it should be written next to a backup it is holding.</summary>
        public static FixtureBackupOwner Mine()
        {
            using var self = Process.GetCurrentProcess();
            return new FixtureBackupOwner(self.Id, DescribeStartTime(self), Environment.MachineName);
        }

        public void WriteTo(string path)
        {
            File.WriteAllLines(path, new[]
            {
                $"{ProcessIdKey}={ProcessId}",
                $"{StartedAtKey}={StartedAtUtc}",
                $"{MachineKey}={MachineName}",
            });
        }

        /// <summary>The owner recorded at <paramref name="path"/>, or null when there is none to read.</summary>
        public static FixtureBackupOwner? ReadFrom(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;

                var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in File.ReadAllLines(path))
                {
                    var separator = line.IndexOf('=');
                    if (separator <= 0) continue;
                    fields[line.Substring(0, separator)] = line.Substring(separator + 1);
                }

                if (!fields.TryGetValue(ProcessIdKey, out var rawPid) ||
                    !int.TryParse(rawPid, NumberStyles.Integer, CultureInfo.InvariantCulture, out var pid))
                {
                    return null;
                }

                fields.TryGetValue(StartedAtKey, out var startedAt);
                fields.TryGetValue(MachineKey, out var machine);

                return new FixtureBackupOwner(pid, startedAt ?? string.Empty, machine ?? string.Empty);
            }
            catch (IOException)
            {
                return null;
            }
            catch (UnauthorizedAccessException)
            {
                return null;
            }
        }

        /// <summary>
        /// Whether the process that claimed the backup is still running.
        ///
        /// Every answer this cannot establish is "yes". Saying a live owner is dead costs the only
        /// copy of a fixture; saying a dead owner is live costs a message telling an operator to
        /// delete a file.
        /// </summary>
        public bool IsStillRunning()
        {
            if (!string.Equals(MachineName, Environment.MachineName, StringComparison.OrdinalIgnoreCase))
                return true;

            if (ProcessId <= 0 || StartedAtUtc.Length == 0) return true;

            try
            {
                using var process = Process.GetProcessById(ProcessId);
                // A recycled PID is a different process, and its backup is not this one's.
                return string.Equals(DescribeStartTime(process), StartedAtUtc, StringComparison.Ordinal);
            }
            catch (ArgumentException)
            {
                // Nothing is running under that id.
                return false;
            }
            catch (Exception)
            {
                return true;
            }
        }

        public string Describe() =>
            $"process {ProcessId} on {(MachineName.Length == 0 ? "an unnamed machine" : MachineName)}" +
            (StartedAtUtc.Length == 0 ? string.Empty : $", started {StartedAtUtc}");

        private static string DescribeStartTime(Process process)
        {
            try
            {
                return process.StartTime.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return string.Empty;
            }
        }
    }

    /// <summary>
    /// The file-level operations a fixture's identity depends on: its content hash and its read-only
    /// attribute. Shared so the backup, the sweep and the tests all agree on what they mean.
    /// </summary>
    public static class FixtureFile
    {
        /// <summary>SHA-256 as uppercase hex, matching what the probe reports.</summary>
        public static string ComputeSha256(string filePath)
        {
            using var sha = SHA256.Create();
            using var stream = File.OpenRead(filePath);
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", string.Empty);
        }

        public static bool IsReadOnly(string path) => File.Exists(path) && new FileInfo(path).IsReadOnly;

        public static void ClearReadOnly(string path)
        {
            if (IsReadOnly(path)) new FileInfo(path).IsReadOnly = false;
        }

        public static void SetReadOnly(string path, bool readOnly)
        {
            if (File.Exists(path)) new FileInfo(path).IsReadOnly = readOnly;
        }
    }

    /// <summary>The outcome of one restore, with a message that names the file it is about.</summary>
    public sealed class FixtureRestoreResult
    {
        private FixtureRestoreResult(string filePath, bool restored, string message)
        {
            FilePath = filePath;
            Restored = restored;
            Message = message;
        }

        public string FilePath { get; }
        public bool Restored { get; }
        public string Message { get; }

        public static FixtureRestoreResult Success(string filePath, string message) =>
            new FixtureRestoreResult(filePath, true, message);

        public static FixtureRestoreResult Failure(string filePath, string message) =>
            new FixtureRestoreResult(filePath, false, message);
    }

    /// <summary>
    /// Cleans the fixture folder before a run starts.
    ///
    /// A killed process leaves a backup next to a fixture it had already modified. Nothing in that
    /// process can help - it is gone - so the guarantee has to come from the next run: find the
    /// backups, put them back, say loudly that a previous run was interrupted, and clear out the
    /// files SolidWorks leaves behind. Everything it touches is inside the root it was given.
    /// </summary>
    public static class FixtureSweeper
    {
        /// <summary>Matches the guard; a fixture is never more than a few levels deep.</summary>
        private const int MaxTraversalDepth = 12;

        /// <summary>
        /// Files SolidWorks and earlier runs leave lying around. Probe backups are excluded: those
        /// are restored, never simply deleted.
        ///
        /// A bare <c>*.bak</c> used to be on this list and is not a SolidWorks leftover at all - it
        /// is the extension everyone reaches for when they copy a file aside by hand, including the
        /// manual before-and-after copies these fixtures are checked against. SolidWorks writes
        /// <c>.swbak</c>; a <c>.bak</c> in the fixture folder belongs to whoever put it there.
        /// </summary>
        private static readonly string[] LeftoverPatterns =
        {
            "~$*",
            "*.~sldprt",
            "*.~sldasm",
            "*.~slddrw",
            "*.swbak",
        };

        /// <summary>Restore any orphaned backup under <paramref name="root"/>, then delete leftovers.</summary>
        public static FixtureSweepReport Sweep(string root) => Sweep(root, owner => owner.IsStillRunning());

        /// <summary>
        /// The sweep, with the liveness test injectable so the concurrent-probe case can be
        /// exercised without starting a second process.
        /// </summary>
        public static FixtureSweepReport Sweep(string root, Func<FixtureBackupOwner, bool> isOwnerAlive)
        {
            var report = new FixtureSweepReport { Root = root };

            // Asked before walking anything: a root that confines nothing would send the walk over a
            // whole volume, to act on none of it once the containment filter below had its say.
            var rootRefusal = RegressionFixtureGuard.DescribeRootRefusal(root);
            if (rootRefusal != null)
            {
                report.Failures.Add($"'{root}' cannot be swept because it is not a usable fixture root: {rootRefusal}");
                return report;
            }

            if (!Directory.Exists(root))
            {
                report.Note = $"nothing swept: '{root}' does not exist";
                return report;
            }

            var files = EnumerateFiles(new DirectoryInfo(root), depth: 0)
                .Where(file => RegressionFixtureGuard.IsInside(file.FullName, root))
                .ToList();

            foreach (var backup in files.Where(IsBackup))
                RestoreOrphanUnlessHeld(backup, isOwnerAlive, report);

            foreach (var claim in files.Where(IsOwnerRecord))
                SweepStrandedClaim(claim, isOwnerAlive, report);

            foreach (var leftover in files.Where(IsLeftover))
                DeleteLeftover(leftover, report);

            return report;
        }

        private static bool IsBackup(FileInfo file) =>
            file.Name.EndsWith(FixtureBackup.BackupSuffix, StringComparison.OrdinalIgnoreCase);

        private static bool IsOwnerRecord(FileInfo file) =>
            file.Name.EndsWith(FixtureBackup.BackupSuffix + FixtureBackup.OwnerSuffix, StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// A backup whose owner is still running is not wreckage - it is the only copy of a fixture
        /// another probe is part way through writing. Restoring it would put the original back over
        /// a half-written file and then delete the copy, leaving that run with nothing to restore
        /// from. So it is reported and left exactly alone, which fails the sweep and stops this run
        /// before it can write in the same folder.
        /// </summary>
        private static void RestoreOrphanUnlessHeld(
            FileInfo backup,
            Func<FixtureBackupOwner, bool> isOwnerAlive,
            FixtureSweepReport report)
        {
            var owner = FixtureBackupOwner.ReadFrom(backup.FullName + FixtureBackup.OwnerSuffix);

            if (owner != null && isOwnerAlive(owner))
            {
                report.Failures.Add(
                    $"{backup.FullName} belongs to {owner.Describe()}, which is still running. Another probe is " +
                    "using this fixture folder; wait for it to finish rather than running two at once.");
                return;
            }

            RestoreOrphan(backup, report);
        }

        /// <summary>A claim whose backup never appeared, or was already put back.</summary>
        private static void SweepStrandedClaim(
            FileInfo claim,
            Func<FixtureBackupOwner, bool> isOwnerAlive,
            FixtureSweepReport report)
        {
            // The restore above may already have taken both of them.
            if (!File.Exists(claim.FullName)) return;

            var backupPath = claim.FullName.Substring(0, claim.FullName.Length - FixtureBackup.OwnerSuffix.Length);
            if (File.Exists(backupPath)) return;

            var owner = FixtureBackupOwner.ReadFrom(claim.FullName);
            if (owner != null && isOwnerAlive(owner))
            {
                report.Failures.Add(
                    $"{claim.FullName} was just claimed by {owner.Describe()}, which is still running and is " +
                    "about to copy the fixture aside. Wait for it to finish rather than running two at once.");
                return;
            }

            DeleteLeftover(claim, report);
        }

        /// <summary>
        /// The backup is the only surviving record of both the bytes and the read-only attribute, so
        /// it is the authority here rather than something to be checked against one.
        /// </summary>
        private static void RestoreOrphan(FileInfo backup, FixtureSweepReport report)
        {
            var fixturePath = backup.FullName.Substring(0, backup.FullName.Length - FixtureBackup.BackupSuffix.Length);
            report.InterruptedRunDetected = true;

            try
            {
                var wasReadOnly = backup.IsReadOnly;
                var expectedHash = FixtureFile.ComputeSha256(backup.FullName);

                FixtureFile.ClearReadOnly(fixturePath);
                File.Copy(backup.FullName, fixturePath, overwrite: true);

                var restoredHash = FixtureFile.ComputeSha256(fixturePath);
                if (!string.Equals(restoredHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                {
                    report.Failures.Add($"{fixturePath}: restoring from {backup.Name} produced SHA-256 {restoredHash}, " +
                                        $"but the backup is {expectedHash}. The backup has been kept.");
                    return;
                }

                FixtureFile.SetReadOnly(fixturePath, wasReadOnly);

                FixtureFile.ClearReadOnly(backup.FullName);
                File.Delete(backup.FullName);

                // The claim outlives the backup it describes only long enough for a crash here to
                // still be recoverable.
                var ownerPath = backup.FullName + FixtureBackup.OwnerSuffix;
                FixtureFile.ClearReadOnly(ownerPath);
                if (File.Exists(ownerPath)) File.Delete(ownerPath);

                report.Restored.Add($"{fixturePath}: restored from an interrupted run ({restoredHash}), read-only={wasReadOnly}");
            }
            catch (Exception error)
            {
                report.Failures.Add($"{fixturePath}: could not be restored from {backup.Name}: {error.Message}");
            }
        }

        private static void DeleteLeftover(FileInfo leftover, FixtureSweepReport report)
        {
            try
            {
                FixtureFile.ClearReadOnly(leftover.FullName);
                File.Delete(leftover.FullName);
                report.Deleted.Add(leftover.FullName);
            }
            catch (Exception error)
            {
                report.Failures.Add($"{leftover.FullName}: could not be deleted: {error.Message}");
            }
        }

        private static bool IsLeftover(FileInfo file)
        {
            // A probe backup that is still here failed to restore; deleting it would destroy the only
            // copy of the original.
            if (file.Name.EndsWith(FixtureBackup.BackupSuffix, StringComparison.OrdinalIgnoreCase)) return false;
            if (!File.Exists(file.FullName)) return false;

            return LeftoverPatterns.Any(pattern => MatchesPattern(file.Name, pattern));
        }

        private static bool MatchesPattern(string name, string pattern)
        {
            if (pattern.StartsWith("*", StringComparison.Ordinal))
                return name.EndsWith(pattern.Substring(1), StringComparison.OrdinalIgnoreCase);

            if (pattern.EndsWith("*", StringComparison.Ordinal))
                return name.StartsWith(pattern.Substring(0, pattern.Length - 1), StringComparison.OrdinalIgnoreCase);

            return string.Equals(name, pattern, StringComparison.OrdinalIgnoreCase);
        }

        private static IEnumerable<FileInfo> EnumerateFiles(DirectoryInfo directory, int depth)
        {
            if (depth > MaxTraversalDepth) yield break;
            if (directory.Attributes.HasFlag(FileAttributes.ReparsePoint)) yield break;

            foreach (var file in directory.GetFiles())
                yield return file;

            foreach (var child in directory.GetDirectories())
            {
                foreach (var file in EnumerateFiles(child, depth + 1))
                    yield return file;
            }
        }
    }

    /// <summary>What the pre-flight sweep found and did.</summary>
    public sealed class FixtureSweepReport
    {
        public string Root { get; set; } = string.Empty;

        /// <summary>True when an orphaned backup was found, meaning an earlier run did not finish.</summary>
        public bool InterruptedRunDetected { get; set; }

        public List<string> Restored { get; } = new List<string>();
        public List<string> Deleted { get; } = new List<string>();
        public List<string> Failures { get; } = new List<string>();
        public string? Note { get; set; }

        /// <summary>Whether the folder was left in a state a run can trust.</summary>
        public bool IsClean => Failures.Count == 0;

        /// <summary>Whether anything at all needed doing.</summary>
        public bool ActedOnAnything => Restored.Count > 0 || Deleted.Count > 0 || Failures.Count > 0;
    }
}
