using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// A content hash of every file the suite is allowed to touch, plus a few it is not.
    ///
    /// The path guard decides what a write is permitted to reach; this decides, after the fact,
    /// what it actually reached. Capture one before a suite and one after: any difference outside
    /// a sandbox is a containment failure, and any unexpected difference inside the fixture root
    /// means a test wrote to the vault instead of to its copy.
    /// </summary>
    public sealed class FixtureTripwire
    {
        /// <summary>Matches the guard's limit; a fixture is never more than a few levels deep.</summary>
        private const int MaxTraversalDepth = 12;

        /// <summary>How many files outside the fixture root are hashed as witnesses.</summary>
        private const int WitnessFileCount = 5;

        private FixtureTripwire(IReadOnlyDictionary<string, string> entries) => Entries = entries;

        /// <summary>Full path to SHA-256, uppercase hex, for every file covered.</summary>
        public IReadOnlyDictionary<string, string> Entries { get; }

        /// <summary>
        /// Hash every file under each directory, and each file, in <paramref name="paths"/>.
        /// </summary>
        public static FixtureTripwire Capture(IEnumerable<string> paths)
        {
            var entries = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (var path in paths)
            {
                if (File.Exists(path))
                {
                    entries[Path.GetFullPath(path)] = Hash(path);
                }
                else if (Directory.Exists(path))
                {
                    foreach (var file in EnumerateFiles(new DirectoryInfo(path), depth: 0))
                        entries[file.FullName] = Hash(file.FullName);
                }
            }

            return new FixtureTripwire(entries);
        }

        /// <summary>The fixture root plus a handful of vault files just outside it.</summary>
        public static IReadOnlyList<string> DefaultWatchList()
        {
            var watched = new List<string> { RegressionFixtureGuard.DefaultFixtureRoot };
            watched.AddRange(WitnessFilesOutsideTheRoot());
            return watched;
        }

        /// <summary>
        /// Every difference from an earlier capture, as one readable line each. Empty means nothing
        /// covered by both captures changed.
        /// </summary>
        public IReadOnlyList<string> DifferencesFrom(FixtureTripwire earlier)
        {
            var differences = new List<string>();

            foreach (var before in earlier.Entries)
            {
                if (!Entries.TryGetValue(before.Key, out var after))
                {
                    differences.Add($"deleted: {before.Key}");
                }
                else if (!string.Equals(before.Value, after, StringComparison.OrdinalIgnoreCase))
                {
                    differences.Add($"modified: {before.Key} ({before.Value} -> {after})");
                }
            }

            foreach (var after in Entries.Keys.Where(key => !earlier.Entries.ContainsKey(key)))
                differences.Add($"created: {after}");

            return differences;
        }

        /// <summary>SHA-256 of one file, uppercase hex, matching what DmWriteProbe reports.</summary>
        public static string Hash(string filePath)
        {
            using var sha = SHA256.Create();
            using var stream = File.OpenRead(filePath);
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", string.Empty);
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

        /// <summary>
        /// Vault files a correct run must leave alone. Chosen from the fixture root's siblings so a
        /// path that escapes upwards - the failure mode a substring guard allows - lands on one.
        /// </summary>
        private static IEnumerable<string> WitnessFilesOutsideTheRoot()
        {
            var parent = Path.GetDirectoryName(RegressionFixtureGuard.DefaultFixtureRoot);
            if (string.IsNullOrEmpty(parent) || !Directory.Exists(parent)) yield break;

            var root = new DirectoryInfo(parent!);
            var found = 0;

            foreach (var file in root.GetFiles().OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase))
            {
                if (found++ >= WitnessFileCount) yield break;
                yield return file.FullName;
            }

            foreach (var sibling in root.GetDirectories().OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase))
            {
                if (RegressionFixtureGuard.IsInside(sibling.FullName, RegressionFixtureGuard.DefaultFixtureRoot))
                    continue;
                if (sibling.Attributes.HasFlag(FileAttributes.ReparsePoint)) continue;

                var first = sibling.GetFiles().OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
                if (first == null) continue;

                if (found++ >= WitnessFileCount) yield break;
                yield return first.FullName;
            }
        }
    }
}
